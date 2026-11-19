param(
  [string]$FixturePath = (Join-Path ([System.IO.Path]::GetTempPath()) 'vitry-platform-fixture.json')
)

$ErrorActionPreference = 'Stop'
$qaProject = 'vitry-handoff-qa'

function Get-QaContainer([string]$Service) {
  $containerIds = @(docker ps --filter "label=com.docker.compose.project=$qaProject" --filter "label=com.docker.compose.service=$Service" --format '{{.ID}}')
  if ($LASTEXITCODE -ne 0 -or $containerIds.Count -ne 1 -or $containerIds[0] -cnotmatch '^[a-f0-9]{12,64}$') {
    throw "O serviço $Service não está ativo no projeto $qaProject."
  }
  return $containerIds[0]
}

$qaApi = Get-QaContainer 'api'
$qaWeb = Get-QaContainer 'web'
$qaDb = Get-QaContainer 'postgres'
$apiPort = docker port $qaApi 3001/tcp
if ($LASTEXITCODE -ne 0 -or $apiPort -cne '127.0.0.1:3401') { throw 'A API deve estar publicada em 127.0.0.1:3401.' }
$webPort = docker port $qaWeb 3000/tcp
if ($LASTEXITCODE -ne 0 -or $webPort -cne '127.0.0.1:3400') { throw 'A web deve estar publicada em 127.0.0.1:3400.' }

$qaMountData = docker inspect --format '{{json .Mounts}}' $qaDb
if ($LASTEXITCODE -ne 0) { throw 'Falha ao consultar o volume do PostgreSQL.' }
$qaMount = $qaMountData | ConvertFrom-Json | Where-Object Destination -ceq '/var/lib/postgresql/data'
if ($qaMount.Name -cne "${qaProject}_db") { throw 'O PostgreSQL precisa usar o volume descartável exclusivo do projeto.' }
$qaVolumeData = docker volume inspect --format '{{json .Labels}}' $qaMount.Name
if ($LASTEXITCODE -ne 0) { throw 'Falha ao consultar o projeto do volume do PostgreSQL.' }
$qaVolume = $qaVolumeData | ConvertFrom-Json
if ($qaVolume.'com.docker.compose.project' -cne $qaProject) { throw 'O volume do PostgreSQL pertence a outro projeto.' }

$fixtureSource = Join-Path $PSScriptRoot 'seed-platform-fixture.cjs'
$payload = Get-Content -Raw -Encoding UTF8 -LiteralPath $fixtureSource | docker exec -i -w /repo/apps/api $qaApi node -
if ($LASTEXITCODE -ne 0) { throw 'Falha ao preparar a fixture do navegador.' }
$fixture = $payload | ConvertFrom-Json
if ($fixture.store.slug -cnotmatch '^qa-platform-[a-f0-9]{10}$') { throw 'O resultado da preparação não é uma fixture de plataforma.' }
[System.IO.File]::WriteAllText([System.IO.Path]::GetFullPath($FixturePath), ($fixture | ConvertTo-Json -Depth 8 -Compress))
Write-Output $qaApi
