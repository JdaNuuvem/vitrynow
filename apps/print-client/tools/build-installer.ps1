# Monta o instalador do print-client de ponta a ponta (PC-09), sem instalar nada:
#   1) build.ps1 (EXE deterministico, libs conferidas, versao do EXE = installer.iss)
#   2) assina o EXE (Authenticode, PC-13) quando ha certificado configurado (tools\sign-code.ps1)
#   3) ISCC (Inno Setup 6) -> bin\Installer\Vitry-Impressao-Setup.exe, e assina o instalador
#   4) scan-identity.ps1 (nenhum rastro do terceiro no codigo, no EXE e no instalador)
#   5) imprime os SHA-256 (EXE e instalador) para o changelog / manifesto de update (tools\sign-update.ps1)
# O EXE SEM assinatura e reprodutivel (mesma fonte => mesmo hash; build.ps1 imprime esse hash). A assinatura muda o hash do arquivo final:
# os dois aparecem no fim. -RequireSignature (use em release publicada) FALHA se nao houver certificado.
param(
    [string]$RoslynDir = "",
    [string]$Iscc = "",
    [switch]$RequireSignature
)
$ErrorActionPreference = "Stop"
$base = Split-Path -Parent $PSScriptRoot
if (-not $Iscc) {
    $Iscc = @("$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe", "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe", "$env:ProgramFiles\Inno Setup 6\ISCC.exe") |
        Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $Iscc -or -not (Test-Path $Iscc)) { throw "Inno Setup 6 nao encontrado. Instale (winget install JRSoftware.InnoSetup) ou passe -Iscc <caminho do ISCC.exe>." }

$sign = Join-Path $PSScriptRoot "sign-code.ps1"
& $sign -Check | Out-Null; $hasCert = ($LASTEXITCODE -eq 0)
if ($RequireSignature -and -not $hasCert) { throw "-RequireSignature: nenhum certificado configurado (VITRY_SIGN_THUMBPRINT ou VITRY_SIGN_PFX)." }

& (Join-Path $base "build.ps1") -RoslynDir $RoslynDir
if ($LASTEXITCODE -ne 0) { throw "build.ps1 falhou ($LASTEXITCODE)" }

$exe = Join-Path $base "bin\Release\Vitry Impressao.exe"
if (-not (Test-Path $exe)) { throw "EXE nao encontrado em $exe" }
$exeUnsigned = (Get-FileHash $exe -Algorithm SHA256).Hash
if ($hasCert) { & $sign -Files $exe }

Push-Location $base
try {
    & $Iscc /Q (Join-Path $base "installer.iss")
    if ($LASTEXITCODE -ne 0) { throw "ISCC falhou ($LASTEXITCODE)" }
} finally { Pop-Location }

$setup = Join-Path $base "bin\Installer\Vitry-Impressao-Setup.exe"
if (-not (Test-Path $setup)) { throw "instalador nao foi gerado em $setup" }
if ($hasCert) { & $sign -Files $setup }

& (Join-Path $PSScriptRoot "scan-identity.ps1") -Root $base
if ($LASTEXITCODE -ne 0) { throw "scan-identity encontrou identidade do terceiro" }

Write-Host ""
Write-Host ("EXE (fonte, sem assinatura) SHA256 " + $exeUnsigned + "  <- reprodutivel")
if ($hasCert) { Write-Host ("EXE assinado                SHA256 " + (Get-FileHash $exe -Algorithm SHA256).Hash) }
Write-Host ("Instalador                  SHA256 " + (Get-FileHash $setup -Algorithm SHA256).Hash + "  (" + (Get-Item $setup).Length + " bytes)  <- vai no manifesto de update")
if (-not $hasCert) { Write-Host "Instalador SEM assinatura de codigo: Windows/SmartScreen mostra 'editor desconhecido'. Configure o certificado (README, Assinatura)." -ForegroundColor Yellow }
