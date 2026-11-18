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
  [int]$MaxSuites = 3,      # suítes completas simultâneas na máquina (regra do BOARD §0)
  [string]$MigrationBase = 'main',   # base para detectar migrações novas (INF-15)
  [switch]$SkipMigrationCheck
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
$nodeMajor = [int](((node -v) -replace '^v', '') -split '\.')[0]
if ($nodeMajor -lt 24) { throw "Node $nodeMajor no PATH: o projeto exige Node 24 (engines em package.json, .nvmrc, Dockerfiles e CI usam 24)" }

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
if ($continue -and -not $SkipMigrationCheck) {
  # INF-15: toda migração nova em relação à base passa pelo verificador (ordem, dados, schema final).
  $continue = Step "migrações novas x $MigrationBase (scripts/check-migrations.sh)" {
    $newMig = @(git diff --name-only "$MigrationBase...HEAD" -- packages/db/prisma/migrations | Where-Object { $_ -match '/migration\.sql$' })
    if ($newMig.Count -eq 0) { Write-Host "nenhuma migração nova em relação a ${MigrationBase}: nada a verificar"; return }
    Write-Host "$($newMig.Count) migração(ões) nova(s) (commitadas) em relação a ${MigrationBase}:"; $newMig | ForEach-Object { Write-Host "  $_" }
    # bash do Git (nunca o launcher do WSL em WindowsApps, que resolve primeiro em alguns PATHs)
    $gitRoot = Split-Path (Split-Path (Get-Command git -ErrorAction Stop).Source)
    $bash = Join-Path $gitRoot 'bin\bash.exe'
    if (-not (Test-Path $bash)) { throw "bash do Git não encontrado em $bash" }
    $env:BASE = $MigrationBase; $env:AGENT = $Agent; $env:PORT = "$Port"
    # A saída é capturada e reescrita com Write-Host: com `ci.ps1 *> log` a saída direta do bash.exe se perdia
    # do log (o verificador rodava, mas não havia prova no arquivo). O código de saída do bash é preservado.
    try {
      $verOut = & $bash (Join-Path $repo 'scripts/check-migrations.sh') HEAD 2>&1
      $verCode = $LASTEXITCODE
      $verOut | ForEach-Object { Write-Host "$_" }
      $global:LASTEXITCODE = $verCode
    }
    finally { Remove-Item Env:\BASE, Env:\AGENT, Env:\PORT -ErrorAction SilentlyContinue }
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
# 4b) TESTE DE TEMPO (SEGURANÇA; decisão do Atlas, 17/11): reset-email-confirmation > "MESMO tempo nas três recusas" (diferença entre medianas < 35 ms e todas
# no piso). É teste de SEGURANÇA: não se silencia nem se afrouxa. Mede tempo ABSOLUTO e por isso falha com a máquina ocupada (medido: em repouso 0 de 5; com 12 laços
# de CPU 1 de 4, diferença de 484 ms; no CI de 1023 s, 143 ms). Roda SOZINHO, ANTES da suíte, e a suíte principal o PULA (-t negativo), para não ser medido em paralelo.
# Regra: passa de 1ª => ok. Falhou => 1 repetição automática (o valor da 1ª falha fica registrado). Passou na repetição => ok com aviso. Falhou nas duas:
#   * em REPOUSO (CPU < 60%) => mais 3 rodadas; BLOQUEIA se >= 2 das 3 falharem OU se o MESMO ramo foi o mais afastado da mediana em TODAS as falhas (INF-20b: o teste
#     tem ~7% de ruído por rodada nesta máquina compartilhada; defeito real é sempre o mesmo ramo). Valores, ramos e CPU de cada tentativa ficam impressos;
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
function Get-CpuAgora { try { [int](Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average } catch { -1 } }
function Get-RamoAfastado($ramos) {  # ramo mais afastado da MEDIANA dos ramos: defeito real = sempre o MESMO ramo; ruído = ramos variados
  if (-not $ramos -or $ramos.Count -lt 3) { return $null }
  $v = @($ramos.Values | Sort-Object); $med = $v[[int][math]::Floor($v.Count / 2)]
  $pior = $ramos.GetEnumerator() | Sort-Object { [math]::Abs($_.Value - $med) } -Descending | Select-Object -First 1
  [pscustomobject]@{ Nome = $pior.Key; Delta = [math]::Round($pior.Value - $med, 0) }
}
function Invoke-TimingTest {  # roda SÓ o teste de tempo; devolve @{ Ok; Valor; Tipo; Texto; Cpu; Lista; Ramo; DeltaTxt }
  $cpu = Get-CpuAgora
  Push-Location (Join-Path $repo 'apps/api')
  try {
    $env:TEST_DATABASE_URL = $testUrl
    $out = node node_modules/vitest/vitest.mjs run $timingFile -t $timingPattern 2>&1 | ForEach-Object { $_ -replace "\x1b\[[0-9;]*m", '' }
    $rc = $LASTEXITCODE
  } finally { Pop-Location }
  # Dois jeitos de falhar COM valor medido: diferença acima do limite ("less than 35") ou tempo ABAIXO do piso ("greater than or equal to <piso>"). Sem nenhum dos
  # dois o teste nem chegou a medir (banco desatualizado, erro de setup): Valor fica vazio e a mensagem final NÃO acusa defeito de segurança.
  $m = $out | Select-String -Pattern 'expected ([0-9.]+) to be (less than|greater than or equal to)' | Select-Object -First 1
  $valor = if ($m) { $m.Matches[0].Groups[1].Value } else { '' }
  $tipo = if ($m -and $m.Matches[0].Groups[2].Value -like 'greater*') { 'piso' } else { 'limite' }
  # "nenhum teste casou" NÃO pode contar como passou: exige 1 teste passado
  $passou = ($rc -eq 0) -and [bool]($out | Select-String -Pattern 'Tests\s+1 passed' -Quiet)
  if (-not $passou -and -not $valor) { $out | Select-Object -Last 12 | ForEach-Object { Write-Host "   $_" } }
  # Medianas por ramo (linha TEMPO_RAMOS que o teste imprime): diz QUAL ramo ficou afastado.
  $ramos = @{}
  $lr = $out | Select-String -Pattern 'TEMPO_RAMOS (\{.*\})' | Select-Object -First 1
  if ($lr) { try { $o = $lr.Matches[0].Groups[1].Value | ConvertFrom-Json; foreach ($p in $o.PSObject.Properties) { $ramos[$p.Name] = [double]$p.Value } } catch { $ramos = @{} } }
  $af = Get-RamoAfastado $ramos
  $lista = if ($ramos.Count) { (($ramos.GetEnumerator() | Sort-Object Name | ForEach-Object { "$($_.Name)=$([math]::Round($_.Value))" }) -join ' ') + ' (ms)' } else { 'ramos não medidos' }
  # Texto = como mostrar o valor: "diferença X ms (limite 35)", "tempo X ms ABAIXO do piso" ou "não medido".
  $texto = if (-not $valor) { 'não medido' } elseif ($tipo -eq 'piso') { "tempo $valor ms ABAIXO do piso" } else { "diferença $valor ms (limite 35)" }
  [pscustomobject]@{ Ok = $passou; Valor = $valor; Tipo = $tipo; Texto = $texto; Cpu = $cpu; Lista = $lista; Ramo = $(if ($af) { $af.Nome } else { '' }); DeltaTxt = $(if ($af) { '{0:+#;-#;0}' -f $af.Delta } else { '' }) }
}
function Format-Tentativa([int]$n, $r) {
  "   tentativa ${n}: CPU $($r.Cpu)% | $(if ($r.Ok) { 'passou' } else { 'FALHOU' }) | $($r.Lista) | $(if ($r.Ramo) { "ramo mais afastado da mediana: $($r.Ramo) ($($r.DeltaTxt) ms)" } else { 'ramo: n/d' })"
}
if ($continue -and -not $SkipTests) {
  $continue = Step 'teste de tempo (SEGURANÇA), isolado, antes da suíte' {
    $carga = Get-CargaConhecida
    Write-Host "   carga antes: CPU $($carga.Cpu)%, outras suítes vitest: $($carga.Outras) => $(if ($carga.Alta) { 'CARGA CONHECIDA (CPU >= 60%)' } else { 'repouso (CPU < 60%)' })"
    $tent = New-Object System.Collections.Generic.List[object]
    $r1 = Invoke-TimingTest; $tent.Add($r1); Write-Host (Format-Tentativa 1 $r1)
    if ($r1.Ok) { Write-Host '   passou de primeira'; $global:LASTEXITCODE = 0; return }
    Write-Host "   1ª tentativa FALHOU ($($r1.Texto)). Repetindo automaticamente 1 vez."
    $r2 = Invoke-TimingTest; $tent.Add($r2); Write-Host (Format-Tentativa 2 $r2)
    if ($r2.Ok) { Write-Host "   AVISO: falhou na 1ª ($($r1.Texto)) e passou na repetição: confira a carga da máquina."; $global:LASTEXITCODE = 0; return }
    Write-Host "   a repetição também FALHOU ($($r2.Texto))."
    # Sem valor nas DUAS falhas = o teste nem mediu (banco de teste desatualizado, migração faltando, erro de setup). Isso não prova defeito de segurança: diga a causa provável.
    if (-not $r1.Valor -and -not $r2.Valor) { throw "teste de tempo falhou 2 vezes SEM valor medido: banco de teste desatualizado ou erro de setup. Rode as migrações (.\scripts\test-db.ps1 -Agent <agente> -Port <porta>) e leia a saída do teste acima; isto NÃO é, por si só, defeito de segurança" }
    if ($carga.Alta) {
      Write-Host '   carga conhecida: esperando 20 s e repetindo 3 vezes; só 3 de 3 libera.'
      Start-Sleep -Seconds 20
      for ($i = 3; $i -le 5; $i++) { $r = Invoke-TimingTest; $tent.Add($r); Write-Host (Format-Tentativa $i $r) }
      if (@($tent | Select-Object -Skip 2 | Where-Object { $_.Ok }).Count -eq 3) { Write-Host "   AVISO: falhas sob carga ($($r1.Texto) e $($r2.Texto)), mas 3 de 3 passaram depois: não bloqueia. Rode o CI com a máquina em repouso." ; $global:LASTEXITCODE = 0; return }
      throw "teste de tempo falhou sob carga E não passou 3 de 3 depois: trate como defeito"
    }
    # REPOUSO (INF-20b, decisão do Atlas 17/11): o teste falha ~7% das rodadas por RUÍDO com a máquina compartilhada (medido: CPU do host 0-49%, picos de 400-1159 ms que
    # estouram o piso), então 2 falhas seguidas NÃO bastam. Mais 3 rodadas; BLOQUEIA se >= 2 das 3 falharem, OU se o MESMO ramo foi o mais afastado em TODAS as falhas (um
    # defeito real é sempre o mesmo ramo; ruído cai em ramos variados). Todas as tentativas (valores e CPU) ficam impressas. O Atlas revê a regra se o bloqueio por ruído passar de 1 em 20 CIs.
    Write-Host '   repouso, 2 falhas seguidas: rodando mais 3 vezes. Bloqueia se >= 2 das 3 falharem OU se o mesmo ramo for o mais afastado em todas as falhas.'
    for ($i = 3; $i -le 5; $i++) { $r = Invoke-TimingTest; $tent.Add($r); Write-Host (Format-Tentativa $i $r) }
    $falhasDepois = @($tent | Select-Object -Skip 2 | Where-Object { -not $_.Ok }).Count
    $falhas = @($tent | Where-Object { -not $_.Ok })
    $ramosFalha = @($falhas | ForEach-Object { $_.Ramo } | Select-Object -Unique)
    $mesmoRamo = ($ramosFalha.Count -eq 1 -and [bool]$ramosFalha[0])
    if ($falhasDepois -ge 2) { throw "teste de tempo falhou 2 vezes seguidas E $falhasDepois das 3 rodadas seguintes (em repouso, CPU $($carga.Cpu)%): é defeito (SEGURANÇA, o tempo de resposta distingue contas); não afrouxe o limite nem o piso. Valores acima" }
    if ($mesmoRamo) { throw "teste de tempo: o MESMO ramo ($($ramosFalha[0])) foi o mais afastado em todas as $($falhas.Count) falhas, mesmo com $falhasDepois de 3 falhando depois: tem cara de defeito real (SEGURANÇA); valores acima" }
    Write-Host "   AVISO: $($falhas.Count) falhas em $($tent.Count) rodadas, mas só $falhasDepois das 3 últimas e em ramos diferentes ($(($falhas | ForEach-Object { if ($_.Ramo) { $_.Ramo } else { 'n/d' } }) -join ', ')): ruído provável, NÃO bloqueia. Conte este aviso: o Atlas revê a regra se o ruído bloquear mais de 1 CI em 20."
    $global:LASTEXITCODE = 0
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
