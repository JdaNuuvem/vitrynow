# Monta o instalador do print-client de ponta a ponta (PC-09), sem instalar nada:
#   1) build.ps1 (EXE deterministico, libs conferidas, versao do EXE = installer.iss)
#   2) ISCC (Inno Setup 6) -> bin\Installer\MeuCardapio-PrintClient-Setup.exe
#   3) scan-identity.ps1 (nenhum rastro do terceiro no codigo, no EXE e no instalador)
#   4) imprime os SHA-256 (EXE e instalador) para o changelog / manifesto de update (tools\sign-update.ps1)
# O EXE e reprodutivel (mesma fonte => mesmo hash). O instalador NAO e bit a bit reprodutivel (o Inno grava data de
# compilacao); o que vale e o hash do EXE dentro dele e o hash do instalador publicado.
param(
    [string]$RoslynDir = "",
    [string]$Iscc = ""
)
$ErrorActionPreference = "Stop"
$base = Split-Path -Parent $PSScriptRoot
if (-not $Iscc) {
    $Iscc = @("$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe", "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe", "$env:ProgramFiles\Inno Setup 6\ISCC.exe") |
        Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $Iscc -or -not (Test-Path $Iscc)) { throw "Inno Setup 6 nao encontrado. Instale (winget install JRSoftware.InnoSetup) ou passe -Iscc <caminho do ISCC.exe>." }

& (Join-Path $base "build.ps1") -RoslynDir $RoslynDir
if ($LASTEXITCODE -ne 0) { throw "build.ps1 falhou ($LASTEXITCODE)" }

Push-Location $base
try {
    & $Iscc /Q (Join-Path $base "installer.iss")
    if ($LASTEXITCODE -ne 0) { throw "ISCC falhou ($LASTEXITCODE)" }
} finally { Pop-Location }

$setup = Join-Path $base "bin\Installer\MeuCardapio-PrintClient-Setup.exe"
if (-not (Test-Path $setup)) { throw "instalador nao foi gerado em $setup" }

& (Join-Path $PSScriptRoot "scan-identity.ps1") -Root $base
if ($LASTEXITCODE -ne 0) { throw "scan-identity encontrou identidade do terceiro" }

$exe = Join-Path $base "bin\Release\MeuCardapio - Impressao.exe"
Write-Host ""
Write-Host ("EXE        SHA256 " + (Get-FileHash $exe -Algorithm SHA256).Hash + "  (" + (Get-Item $exe).Length + " bytes)")
Write-Host ("Instalador SHA256 " + (Get-FileHash $setup -Algorithm SHA256).Hash + "  (" + (Get-Item $setup).Length + " bytes)")
Write-Host "Instalador sem assinatura de codigo (Authenticode): Windows/SmartScreen mostra 'editor desconhecido' ate o PC-13 (gasto: aval do Claudio)." -ForegroundColor Yellow
