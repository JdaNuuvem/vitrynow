<#
.SYNOPSIS
  Postgres de teste descartável, por agente (INF-01). Sobe um container na SUA porta, cria os bancos
  meucardapio e meucardapio_test e aplica as migrations do worktree em que você está.

.EXAMPLE
  .\scripts\test-db.ps1 -Agent turing -Port 55444          # sobe (ou reaproveita) e migra
  .\scripts\test-db.ps1 -Agent turing -Port 55444 -Fresh   # recria do zero (apaga os dados de teste)
  .\scripts\test-db.ps1 -Agent turing -Port 55444 -Down    # remove o container

  # depois, no MESMO terminal, rode os testes da API contra o SEU banco:
  $env:TEST_DATABASE_URL = "postgresql://meucardapio:meucardapio@127.0.0.1:55444/meucardapio_test?schema=public"
  pnpm --filter @meucardapio/api test

.NOTES
  - Só aceita portas de 55440 a 55459 (faixas por agente no BOARD.md §0). Nunca usa o banco de dev (55432).
  - Container: mc-test-<agente>-<porta>, ligado só a 127.0.0.1, senha fixa de TESTE (não é segredo).
  - Idempotente: se já existe e está rodando, só confere/aplica migrations novas.
  - Migration nova no seu branch? Rode de novo (sem -Fresh): aplica só as pendentes.
#>
param(
  [Parameter(Mandatory = $true)][ValidatePattern('^[a-z0-9-]+$')][string]$Agent,
  [Parameter(Mandatory = $true)][ValidateRange(55440, 55459)][int]$Port,
  [switch]$Fresh,
  [switch]$Down,
  [switch]$SkipMigrate
)
# Continue (e não Stop): no PowerShell 5.1, se o chamador redireciona stderr (2>&1, *>), o stderr de comandos
# nativos vira erro terminante. O sucesso de cada comando nativo é checado por $LASTEXITCODE.
$ErrorActionPreference = 'Continue'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$name = "mc-test-$Agent-$Port"
$pw = 'meucardapio'   # senha de TESTE; o container só escuta em 127.0.0.1
$dbs = @('meucardapio', 'meucardapio_test')

function Test-Container([string]$n) { (docker ps -a --filter "name=^/$n$" --format '{{.Names}}') -eq $n }
function Test-Running([string]$n) { (docker ps --filter "name=^/$n$" --format '{{.Names}}') -eq $n }

if ($Down) {
  if (Test-Container $name) { docker rm -f $name | Out-Null; Write-Host "removido: $name" } else { Write-Host "não existe: $name" }
  return
}

# A porta não pode estar em uso por OUTRO container (cada agente fica na sua faixa).
$holder = docker ps --format '{{.Names}} {{.Ports}}' | Where-Object { $_ -match "[:>]$Port->" -and $_ -notmatch "^$name " }
if ($holder) { throw "porta $Port já usada por: $holder. Use a sua faixa do BOARD.md §0 ou rode -Down no outro." }

if ($Fresh -and (Test-Container $name)) { docker rm -f $name | Out-Null; Write-Host "recriando $name" }
if (-not (Test-Container $name)) {
  docker run -d --name $name -e POSTGRES_USER=meucardapio -e POSTGRES_PASSWORD=$pw -e POSTGRES_DB=meucardapio `
    -p "127.0.0.1:${Port}:5432" --label mc-test=1 --label "mc-agent=$Agent" postgres:16-alpine | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "docker run falhou" }
} elseif (-not (Test-Running $name)) {
  docker start $name | Out-Null
}

$ready = $false
for ($i = 0; $i -lt 60; $i++) {
  docker exec $name pg_isready -U meucardapio -d meucardapio *> $null
  if ($LASTEXITCODE -eq 0) { $ready = $true; break }
  Start-Sleep -Seconds 1
}
if (-not $ready) { throw "postgres de $name não ficou pronto em 60s (docker logs $name)" }

foreach ($db in $dbs) {
  $exists = docker exec $name psql -U meucardapio -d postgres -At -c "select 1 from pg_database where datname='$db'"
  if (-not $exists) { docker exec $name psql -U meucardapio -d postgres -c "create database $db" | Out-Null }
}

if (-not $SkipMigrate) {
  Push-Location $repo
  try {
    if (-not (Test-Path (Join-Path $repo 'node_modules'))) { Write-Host 'node_modules ausente: rodando pnpm install...'; pnpm install --frozen-lockfile; if ($LASTEXITCODE -ne 0) { pnpm install } }
    pnpm --filter '@meucardapio/db' generate | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'prisma generate falhou' }
    foreach ($db in $dbs) {
      $env:DATABASE_URL = "postgresql://meucardapio:$pw@127.0.0.1:$Port/${db}?schema=public"
      Write-Host "migrate deploy -> $db"
      pnpm --filter '@meucardapio/db' exec prisma migrate deploy
      if ($LASTEXITCODE -ne 0) { throw "migrate deploy falhou em $db" }
    }
  } finally { Remove-Item Env:\DATABASE_URL -ErrorAction SilentlyContinue; Pop-Location }
}

Write-Host ""
Write-Host "PRONTO: $name (127.0.0.1:$Port)" -ForegroundColor Green
Write-Host "  `$env:DATABASE_URL      = `"postgresql://meucardapio:$pw@127.0.0.1:$Port/meucardapio?schema=public`""
Write-Host "  `$env:TEST_DATABASE_URL = `"postgresql://meucardapio:$pw@127.0.0.1:$Port/meucardapio_test?schema=public`""
Write-Host "  pnpm --filter @meucardapio/api test"
