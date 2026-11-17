<#
.SYNOPSIS
  CI local (INF-05): o mesmo portão que qualquer entrega precisa passar antes de ir para review.

.EXAMPLE
  .\scripts\ci.ps1 -Agent turing -Port 55444            # tudo, menos build das imagens
  .\scripts\ci.ps1 -Agent turing -Port 55444 -Images    # inclui build Docker de api/web e validação do compose
  .\scripts\ci.ps1 -Agent turing -Port 55444 -SkipTests # só install, migrations, drift e tipos

.DESCRIPTION
  1. pnpm install --frozen-lockfile (falha se package.json e pnpm-lock.yaml divergirem)
  2. Postgres de teste do agente (scripts/test-db.ps1) com as migrations aplicadas
  3. prisma validate + checagem de DRIFT: o banco migrado tem de ser idêntico ao schema.prisma
     (pegou alguém mudar o schema sem criar migration)
  4. typecheck de db, shared-types, api e web (script "typecheck" do pacote, ou tsc --noEmit)
  5. testes da API contra o SEU banco (TEST_DATABASE_URL), nunca o de dev
  6. (-Images) valida o compose de produção e constrói as imagens api e web
  Sai com código != 0 se qualquer etapa falhar e imprime um resumo no fim.
#>
param(
  [Parameter(Mandatory = $true)][ValidatePattern('^[a-z0-9-]+$')][string]$Agent,
  [Parameter(Mandatory = $true)][ValidateRange(55440, 55459)][int]$Port,
  [switch]$SkipTests,
  [switch]$Images,
  [int]$WaitMinutes = 30,   # quanto esperar por uma vaga se a máquina já estiver cheia
  [int]$MaxSuites = 3       # suítes completas simultâneas na máquina (regra do BOARD §0)
)
# Continue (e não Stop): ver nota em test-db.ps1 (stderr redirecionado no PowerShell 5.1).
$ErrorActionPreference = 'Continue'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $repo
$results = New-Object System.Collections.Generic.List[object]
$dbUrl = "postgresql://meucardapio:meucardapio@127.0.0.1:$Port/meucardapio?schema=public"
$testUrl = "postgresql://meucardapio:meucardapio@127.0.0.1:$Port/meucardapio_test?schema=public"

function Step([string]$name, [scriptblock]$body) {
  Write-Host "`n=== $name" -ForegroundColor Cyan
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $ok = $true; $note = ''
  try {
    $global:LASTEXITCODE = 0
    & $body | Out-Host   # só o booleano pode sair de Step; a saída dos comandos vai para a tela
    if ($LASTEXITCODE -ne 0) { $ok = $false; $note = "exit $LASTEXITCODE" }
  } catch { $ok = $false; $note = $_.Exception.Message }
  $sw.Stop()
  $results.Add([pscustomobject]@{ Etapa = $name; Resultado = $(if ($ok) { 'OK' } else { 'FALHA' }); Tempo = ('{0:n0}s' -f $sw.Elapsed.TotalSeconds); Nota = $note })
  if (-not $ok) { Write-Host "FALHA em '$name': $note" -ForegroundColor Red }
  return $ok
}

# Limite de paralelismo (INF-14, regra do Atlas no BOARD §0): no máximo $MaxSuites suítes completas ao mesmo tempo
# na máquina; as demais esperam. Duas cargas pesadas juntas já derrubaram o Docker 3 vezes. Usa N mutexes nomeados
# (slot0..slotN-1) e não um semáforo: o SO libera o mutex se o processo morrer, o semáforo vazaria a vaga.
$freeGb = [math]::Round((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1MB, 1)
if ($freeGb -lt 3) { Write-Host "AVISO: só $freeGb GB de RAM livre; a máquina está sobrecarregada (outras suítes/builds rodando?). Prefira esperar." -ForegroundColor Yellow }
$ciLock = $null
function Get-CiSlot {
  for ($i = 0; $i -lt $MaxSuites; $i++) {
    $m = New-Object System.Threading.Mutex($false, "Global\meucardapio-ci-pesado-slot$i")
    $got = $false
    try { $got = $m.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $got = $true }
    if ($got) { return $m }
    $m.Dispose()
  }
  return $null
}
$ciLock = Get-CiSlot
if (-not $ciLock) {
  Write-Host "Já há $MaxSuites suítes completas rodando nesta máquina; aguardando uma vaga (até $WaitMinutes min) para não sobrecarregar o Docker..." -ForegroundColor Yellow
  $deadline = (Get-Date).AddMinutes($WaitMinutes)
  while (-not $ciLock -and (Get-Date) -lt $deadline) { Start-Sleep -Seconds 10; $ciLock = Get-CiSlot }
  if (-not $ciLock) { Write-Host "Desisti após $WaitMinutes min sem vaga. Tente de novo mais tarde." -ForegroundColor Red; exit 3 }
}
foreach ($tool in 'node', 'pnpm', 'docker') { if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "$tool não encontrado no PATH" } }

$continue = $true
if ($continue) { $continue = Step 'install (lockfile congelado)' { pnpm install --frozen-lockfile } }
if ($continue) { $continue = Step "postgres de teste (${Agent}:${Port}) + migrations" { & "$PSScriptRoot\test-db.ps1" -Agent $Agent -Port $Port } }
if ($continue) {
  $continue = Step 'prisma validate + drift (migrations x schema.prisma)' {
    $env:DATABASE_URL = $dbUrl
    pnpm --filter '@meucardapio/db' exec prisma validate
    if ($LASTEXITCODE -ne 0) { return }
    pnpm --filter '@meucardapio/db' exec prisma migrate diff --from-url $dbUrl --to-schema-datamodel prisma/schema.prisma --exit-code
    if ($LASTEXITCODE -eq 2) { throw 'DRIFT: o schema.prisma tem mudanças sem migration (crie a migration com o ID da tarefa)' }
  }
}
if ($continue) {
  $continue = Step 'typecheck (db, shared-types, api, web)' {
    pnpm --filter '@meucardapio/db' generate | Out-Null
    # api e web resolvem os pacotes do workspace pelos tipos de dist/ (como no Dockerfile): compilar antes.
    pnpm --filter '@meucardapio/shared-types' build; if ($LASTEXITCODE -ne 0) { throw 'build de shared-types falhou' }
    pnpm --filter '@meucardapio/db' build; if ($LASTEXITCODE -ne 0) { throw 'build de db falhou' }
    foreach ($pkg in 'packages/db', 'packages/shared-types', 'apps/api', 'apps/web') {
      $pj = Get-Content (Join-Path $repo "$pkg/package.json") -Raw | ConvertFrom-Json
      $name = $pj.name
      if ($pj.scripts.PSObject.Properties.Name -contains 'typecheck') { pnpm --filter $name run typecheck }
      else { pnpm --filter $name exec tsc --noEmit }
      if ($LASTEXITCODE -ne 0) { throw "typecheck falhou em $name" }
    }
  }
}
# 3b) TYPECHECK DOS TESTES DA API (INF-23): o tsconfig.json da API só inclui `src`, então os testes NUNCA eram checados pelo tipo (8 chamadas de `subscribe` com a assinatura
# antiga passaram assim). tsconfig.test.json inclui `tests`. O estágio falha por erro NOVO; os erros antigos ficam em apps/api/tsconfig.test.baseline.txt (uma linha por erro,
# SEM linha/coluna, que mudam a cada edição) e só podem DIMINUIR: corrigiu um? remova a linha do baseline (o estágio avisa). Regerar: $env:UPDATE_TSC_BASELINE = '1'; .\scripts\ci.ps1 ...
if ($continue -and -not $SkipTests) {
  $continue = Step 'typecheck dos TESTES da API (nenhum erro de tipo NOVO; baseline de erros antigos)' {
    Push-Location (Join-Path $repo 'apps/api')
    try { $saida = node node_modules/typescript/bin/tsc -p tsconfig.test.json --noEmit 2>&1 | ForEach-Object { "$_" }; $rc = $LASTEXITCODE } finally { Pop-Location }
    $erros = @($saida | Where-Object { $_ -match ' error TS\d+:' })
    if ($rc -ne 0 -and -not $erros.Count) { $saida | Select-Object -First 15 | ForEach-Object { Write-Host "   $_" }; throw 'tsc dos testes falhou sem listar erro de tipo (configuração?)' }
    $norm = @($erros | ForEach-Object { $l = ($_ -replace '\(\d+,\d+\)', '') -replace '\s+', ' '; if ($l.Length -gt 220) { $l.Substring(0, 220) } else { $l } })
    $baseFile = Join-Path $repo 'apps/api/tsconfig.test.baseline.txt'
    if ($env:UPDATE_TSC_BASELINE -eq '1') { [IO.File]::WriteAllLines($baseFile, [string[]]($norm | Sort-Object), (New-Object Text.UTF8Encoding($false))); Write-Host "   baseline REGERADO com $($norm.Count) erro(s): $baseFile"; $global:LASTEXITCODE = 0; return }
    $base = if (Test-Path $baseFile) { @(Get-Content $baseFile -Encoding UTF8 | Where-Object { $_ }) } else { @() }
    $cn = @{}; foreach ($l in $norm) { $cn[$l] = 1 + [int]$cn[$l] }
    $cb = @{}; foreach ($l in $base) { $cb[$l] = 1 + [int]$cb[$l] }
    $novos = @(); foreach ($k in $cn.Keys) { $extra = $cn[$k] - [int]$cb[$k]; if ($extra -gt 0) { $novos += "$extra x $k" } }
    $sumiram = 0; foreach ($k in $cb.Keys) { $falta = $cb[$k] - [int]$cn[$k]; if ($falta -gt 0) { $sumiram += $falta } }
    Write-Host "   erros de tipo nos testes: $($norm.Count) (baseline: $($base.Count); novos: $($novos.Count); corrigidos desde o baseline: $sumiram)"
    if ($sumiram -gt 0) { Write-Host "   AVISO: $sumiram erro(s) do baseline já não ocorrem: remova-os de apps/api/tsconfig.test.baseline.txt (regerar: `$env:UPDATE_TSC_BASELINE='1')." -ForegroundColor Yellow }
    if ($novos.Count) { $novos | ForEach-Object { Write-Host "   NOVO: $_" -ForegroundColor Red }; throw "$($novos.Count) erro(s) de tipo NOVO(S) nos testes da API (veja NOVO: acima); corrija o teste ou a assinatura" }
    $global:LASTEXITCODE = 0
  }
}
# 4b) TESTE DE TEMPO (SEGURANÇA; decisão do Atlas, 17/11): reset-email-confirmation > "MESMO tempo nas três recusas" (diferença entre medianas < 35 ms e todas
# no piso). É teste de SEGURANÇA: não se silencia nem se afrouxa. Mede tempo ABSOLUTO e por isso falha com a máquina ocupada (medido: em repouso 0 de 5; com 12 laços
# de CPU 1 de 4, diferença de 484 ms; no CI de 1023 s, 143 ms). Roda SOZINHO, ANTES da suíte, e a suíte principal o PULA (-t negativo), para não ser medido em paralelo.
# Regra: passa de 1ª => ok. Falhou => 1 repetição automática (o valor da 1ª falha fica registrado). Passou na repetição => ok com aviso. Falhou nas duas:
#   * em REPOUSO (CPU < 60% e nenhuma outra suíte rodando) => BLOQUEIA;
#   * sob carga CONHECIDA => espera 20 s e roda mais 3 vezes: 3 de 3 => não bloqueia (aviso com os números); senão BLOQUEIA.
# Padrão do nome em ASCII (. no lugar de ê): sem BOM o PowerShell 5.1 lê o .ps1 como ANSI e o acento viraria lixo.
$timingFile = 'tests/reset-email-confirmation.test.ts'
$timingPattern = 'MESMO\stempo\snas\str.s\srecusas'
function Get-CargaConhecida {  # devolve @{ Cpu=<int|-1>; Outras=<n suítes vitest alheias>; Alta=<bool> }
  $vals = @(); for ($i = 0; $i -lt 3; $i++) { try { $vals += [int](Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average } catch { }; Start-Sleep -Seconds 1 }
  $cpu = if ($vals.Count) { [int](($vals | Measure-Object -Average).Average) } else { -1 }
  $outras = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match 'vitest' -and $_.CommandLine -notmatch 'reset-email-confirmation' }).Count
  # LIMIAR CALIBRADO POR MEDIÇÃO em 17/11/2026 (INF-20-calibracao-carga.log): com CPU 33 a 39% e 3 suítes vitest de OUTROS agentes rodando, o teste passou 5 de 5;
  # com 12 laços saturando a CPU em 100%, passou 2 de 5 (diferenças 56, 299 e 990 ms nas falhas). Por isso SÓ a CPU decide: >= 60% = carga conhecida. 'Outras suítes'
  # NÃO entra no critério: numa máquina compartilhada é quase sempre > 0 e, sozinha, não derrubou o teste. LIMITES: 5 rodadas por condição; nada medido entre 40% e 99%
  # (o 60% é conservador, não demonstrado); outros agentes mudam a carga sem aviso. Reavalie se o estágio falhar com CPU < 60% ou passar com folga acima de 60%.
  [pscustomobject]@{ Cpu = $cpu; Outras = $outras; Alta = ($cpu -ge 60) }
}
function Invoke-TimingTest {  # roda SÓ o teste de tempo; devolve @{ Ok; Valor }
  Push-Location (Join-Path $repo 'apps/api')
  try {
    $env:TEST_DATABASE_URL = $testUrl
    $out = node node_modules/vitest/vitest.mjs run $timingFile -t $timingPattern 2>&1 | ForEach-Object { $_ -replace "\x1b\[[0-9;]*m", '' }
    $rc = $LASTEXITCODE
  } finally { Pop-Location }
  $m = $out | Select-String -Pattern 'expected ([0-9.]+) to be less than' | Select-Object -First 1
  $valor = if ($m) { $m.Matches[0].Groups[1].Value } else { '' }
  # "nenhum teste casou" NÃO pode contar como passou: exige 1 teste passado
  $passou = ($rc -eq 0) -and [bool]($out | Select-String -Pattern 'Tests\s+1 passed' -Quiet)
  if (-not $passou -and -not $valor) { $out | Select-Object -Last 12 | ForEach-Object { Write-Host "   $_" } }
  [pscustomobject]@{ Ok = $passou; Valor = $valor }
}
if ($continue -and -not $SkipTests) {
  $continue = Step 'teste de tempo (SEGURANÇA), isolado, antes da suíte' {
    $carga = Get-CargaConhecida
    Write-Host "   carga antes: CPU $($carga.Cpu)%, outras suítes vitest: $($carga.Outras) => $(if ($carga.Alta) { 'CARGA CONHECIDA (CPU >= 60%)' } else { 'repouso (CPU < 60%)' })"
    $r1 = Invoke-TimingTest
    if ($r1.Ok) { Write-Host '   passou de primeira'; $global:LASTEXITCODE = 0; return }
    Write-Host "   1ª tentativa FALHOU (diferença medida: $($r1.Valor) ms; limite 35). Repetindo automaticamente 1 vez."
    $r2 = Invoke-TimingTest
    if ($r2.Ok) { Write-Host "   AVISO: falhou na 1ª ($($r1.Valor) ms) e passou na repetição: confira a carga da máquina."; $global:LASTEXITCODE = 0; return }
    Write-Host "   a repetição também FALHOU (diferença medida: $($r2.Valor) ms)."
    if (-not $carga.Alta) { throw "teste de tempo falhou 2 vezes EM REPOUSO ($($r1.Valor) e $($r2.Valor) ms; limite 35): é defeito (SEGURANÇA, o tempo de resposta distingue contas); não afrouxe o limite" }
    Write-Host '   carga conhecida: esperando 20 s e repetindo 3 vezes; só 3 de 3 libera.'
    Start-Sleep -Seconds 20
    $vals = @(); for ($i = 0; $i -lt 3; $i++) { $r = Invoke-TimingTest; $vals += $(if ($r.Ok) { 'ok' } else { "falhou($($r.Valor) ms)" }) }
    if (($vals | Where-Object { $_ -eq 'ok' }).Count -eq 3) { Write-Host "   AVISO: falhas sob carga ($($r1.Valor) e $($r2.Valor) ms), mas 3 de 3 passaram depois: não bloqueia. Rode o CI com a máquina em repouso." ; $global:LASTEXITCODE = 0; return }
    throw "teste de tempo falhou sob carga E não passou 3 de 3 depois ($($vals -join ', ')): trate como defeito"
  }
}

if ($continue -and -not $SkipTests) {
  $continue = Step 'testes da API' {
    $env:TEST_DATABASE_URL = $testUrl
    # A suíte principal PULA só o teste de tempo (ele roda sozinho, antes; ver 4b). -t negativo, ASCII e sem espaços; node direto (o shim do pnpm quebra argumentos).
    Push-Location (Join-Path $repo 'apps/api')
    try { node node_modules/vitest/vitest.mjs run -t ('^((?!' + $timingPattern + ').)*$') } finally { Pop-Location }
  }
}
if ($continue -and -not $SkipTests) {
  $webPj = Get-Content (Join-Path $repo 'apps/web/package.json') -Raw | ConvertFrom-Json
  if ($webPj.scripts.PSObject.Properties.Name -contains 'test') {
    $continue = Step 'testes do web' { pnpm --filter '@meucardapio/web' test }
  }
}
if ($continue -and $Images) {
  $continue = Step 'compose de produção: validar e construir imagens' {
    # valores FALSOS só para validar a sintaxe; nada disto é segredo real
    $envFile = Join-Path ([IO.Path]::GetTempPath()) "mc-ci-$Agent.env"
    @('POSTGRES_PASSWORD=ci-nao-e-segredo', 'JWT_SECRET=ci-nao-e-segredo-ci-nao-e-segredo', 'WEB_ORIGIN=https://exemplo.invalid',
      'NEXT_PUBLIC_API_URL=https://exemplo.invalid', 'DOMAIN=exemplo.invalid', 'ACME_EMAIL=ci@exemplo.invalid', 'APP_VERSION=ci') | Set-Content -Path $envFile -Encoding ascii
    try {
      docker compose -f infra/docker-compose.yml --env-file $envFile config -q
      if ($LASTEXITCODE -ne 0) { throw 'compose config inválido' }
      docker compose -f infra/docker-compose.yml --env-file $envFile -p "mc-ci-$Agent" build api web
    } finally { Remove-Item $envFile -ErrorAction SilentlyContinue }
  }
}

Write-Host "`n(banco de teste mantido em mc-test-$Agent-$Port; remova com: .\scripts\test-db.ps1 -Agent $Agent -Port $Port -Down)"
Write-Host "`n=== RESUMO" -ForegroundColor Cyan
$results | Format-Table -AutoSize | Out-String | Write-Host
$failed = @($results | Where-Object Resultado -eq 'FALHA').Count
if ($failed -gt 0) { Write-Host "CI: $failed etapa(s) com falha" -ForegroundColor Red; try { if ($ciLock) { $ciLock.ReleaseMutex() } } catch {}; exit 1 }
Write-Host 'CI: tudo verde' -ForegroundColor Green
try { if ($ciLock) { $ciLock.ReleaseMutex() } } catch {}
exit 0
