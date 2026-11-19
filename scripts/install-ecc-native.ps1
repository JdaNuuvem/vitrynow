<#
.SYNOPSIS
  Instala o ECC pelo gerenciador nativo de plugins do Codex.
.EXAMPLE
  .\scripts\install-ecc-native.ps1 -CheckOnly
.EXAMPLE
  .\scripts\install-ecc-native.ps1 -GitPath 'C:\Program Files\Git\cmd\git.exe'
#>
[CmdletBinding()]
param(
  [string]$CodexPath,
  [string]$GitPath,
  [switch]$CheckOnly
)

$ErrorActionPreference = 'Stop'

function Resolve-Tool([string]$Override, [string]$Name, [string[]]$Candidates) {
  if ($Override) {
    if (-not (Test-Path -LiteralPath $Override -PathType Leaf)) {
      throw "Executável informado não encontrado: $Override"
    }
    return (Resolve-Path -LiteralPath $Override).Path
  }
  $command = Get-Command $Name -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($command) { return $command.Source }
  foreach ($candidate in $Candidates) {
    if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) { return $candidate }
  }
  return $null
}

function Invoke-Codex([string[]]$CommandArguments) {
  # Argumentos fixos, sem dados do usuário; stdout e stderr ficam separados para ler o JSON.
  $start = New-Object System.Diagnostics.ProcessStartInfo
  $start.FileName = $resolvedCodex
  $start.Arguments = $CommandArguments -join ' '
  $start.UseShellExecute = $false
  $start.CreateNoWindow = $true
  $start.RedirectStandardOutput = $true
  $start.RedirectStandardError = $true
  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $start
  try {
    [void]$process.Start()
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    $process.WaitForExit()
    $stdout = $stdoutTask.Result
    $stderr = $stderrTask.Result
    if ($stdout) { Write-Host $stdout.TrimEnd() }
    if ($stderr) { Write-Host $stderr.TrimEnd() -ForegroundColor Yellow }
    if ($process.ExitCode -ne 0) {
      throw "Codex falhou em '$($CommandArguments -join ' ')' (código $($process.ExitCode)). As próximas etapas não foram executadas."
    }
    return $stdout
  } finally {
    $process.Dispose()
  }
}

try {
  $codexCandidates = @()
  if ($env:LOCALAPPDATA) {
    $codexCandidates += Join-Path $env:LOCALAPPDATA 'Programs\OpenAI\Codex\bin\codex.exe'
  }
  if ($env:USERPROFILE) {
    $releaseRoot = Join-Path $env:USERPROFILE '.codex\packages\standalone\releases'
    if (Test-Path -LiteralPath $releaseRoot -PathType Container) {
      $codexCandidates += @(Get-ChildItem -LiteralPath $releaseRoot -Directory |
        Sort-Object LastWriteTime -Descending |
        ForEach-Object { Join-Path $_.FullName 'bin\codex.exe' })
    }
  }
  $gitCandidates = @()
  if ($env:ProgramFiles) { $gitCandidates += Join-Path $env:ProgramFiles 'Git\cmd\git.exe' }
  if ($env:LOCALAPPDATA) { $gitCandidates += Join-Path $env:LOCALAPPDATA 'Programs\Git\cmd\git.exe' }

  $resolvedCodex = Resolve-Tool $CodexPath 'codex.exe' $codexCandidates
  $resolvedGit = Resolve-Tool $GitPath 'git.exe' $gitCandidates
  $useDefaultHome = [string]::IsNullOrWhiteSpace($env:CODEX_HOME)
  if ($useDefaultHome) {
    if (-not $env:USERPROFILE) { throw 'USERPROFILE indisponível. Defina CODEX_HOME antes de executar.' }
    $effectiveHome = Join-Path $env:USERPROFILE '.codex'
  } else {
    $effectiveHome = $env:CODEX_HOME
  }

  Write-Host ('Codex: ' + $(if ($resolvedCodex) { $resolvedCodex } else { 'não encontrado' }))
  Write-Host ('Git: ' + $(if ($resolvedGit) { $resolvedGit } else { 'não encontrado' }))
  Write-Host "CODEX_HOME previsto: $effectiveHome"
  if ($CheckOnly) {
    Write-Host 'Somente diagnóstico: nenhum comando Codex executado; CODEX_HOME e PATH não foram alterados.'
  }
  if (-not $resolvedCodex) {
    throw 'Codex não encontrado. Instale ou atualize o Codex, ou informe -CodexPath com o caminho de codex.exe.'
  }
  if (-not $resolvedGit) {
    throw 'Git não encontrado. Instale o Git para Windows pelo site oficial https://git-scm.com/download/win, reabra o PowerShell e execute novamente. Se já estiver instalado em outro local, informe -GitPath com o caminho de git.exe.'
  }
  if ($CheckOnly) {
    Write-Host 'Pré-requisitos localizados. Execute sem -CheckOnly para instalar o ECC.'
    exit 0
  }

  if ($useDefaultHome) { $env:CODEX_HOME = $effectiveHome }
  $gitDirectory = Split-Path -Parent $resolvedGit
  if (($env:PATH -split ';') -notcontains $gitDirectory) { $env:PATH = "$gitDirectory;$env:PATH" }

  Write-Host '1/3 Registrando o marketplace affaan-m/ECC...'
  $null = Invoke-Codex -CommandArguments @('plugin', 'marketplace', 'add', 'affaan-m/ECC')
  Write-Host '2/3 Instalando ecc@ecc...'
  $null = Invoke-Codex -CommandArguments @('plugin', 'add', 'ecc@ecc')
  Write-Host '3/3 Consultando o registro local de plugins...'
  $listJson = Invoke-Codex -CommandArguments @('plugin', 'list', '--json')
  try { $plugins = $listJson | ConvertFrom-Json } catch {
    throw 'A listagem não retornou JSON válido em stdout. A instalação pode ter ocorrido, mas sua verificação ficou incompleta.'
  }
  $ecc = @($plugins.installed | Where-Object {
    ($_.pluginId -eq 'ecc@ecc' -or ($_.name -eq 'ecc' -and $_.marketplaceName -eq 'ecc')) -and
    $_.installed -eq $true -and $_.enabled -eq $true
  })
  if ($ecc.Count -eq 0) {
    throw 'O registro local não confirmou ecc@ecc instalado e habilitado. Confira a saída da listagem antes de prosseguir.'
  }
  Write-Host 'ECC instalado e habilitado no registro local do Codex.' -ForegroundColor Green
  Write-Host 'Avisos de rede na listagem não confirmam disponibilidade remota. A checagem completa do cache é uma verificação separada com o verificador do ECC; não pertence aos testes do VitryNow.'
} catch {
  Write-Host "Falha: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
