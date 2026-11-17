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
    try { & $bash (Join-Path $repo 'scripts/check-migrations.sh') HEAD }
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
if ($continue -and -not $SkipTests) {
  $continue = Step 'testes da API' {
    $env:TEST_DATABASE_URL = $testUrl
    pnpm --filter '@meucardapio/api' test
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
if ($failed -gt 0) { Write-Host "CI: $failed etapa(s) com falha" -ForegroundColor Red; exit 1 }
Write-Host 'CI: tudo verde' -ForegroundColor Green
exit 0
