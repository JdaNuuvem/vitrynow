# Assinatura de código Authenticode (PC-13) do EXE e do instalador. Sem ela o Windows/SmartScreen mostra "editor desconhecido".
# Usa o Set-AuthenticodeSignature do próprio Windows (sem Windows SDK/signtool). SHA-256 + carimbo de tempo RFC 3161:
# com carimbo, a assinatura continua válida depois que o certificado vencer.
#
# De onde vem o certificado (o PRIMEIRO que estiver definido):
#   VITRY_SIGN_THUMBPRINT   impressão digital de um certificado já no repositório do Windows (CurrentUser\My ou LocalMachine\My).
#                           É o caminho de token USB EV / HSM na nuvem: a chave privada nunca sai do dispositivo.
#   VITRY_SIGN_PFX + VITRY_SIGN_PFX_PASSWORD   arquivo .pfx (certificado OV). NUNCA no repositório; senha só em variável de ambiente.
#   VITRY_SIGN_TIMESTAMP    servidor de carimbo (padrão http://timestamp.digicert.com; "none" só em teste local, sem internet)
#
#   .\tools\sign-code.ps1 -Files "bin\Release\Vitry Impressao.exe"          assina e confere
#   .\tools\sign-code.ps1 -Check                                            só diz se há certificado configurado (exit 0/1)
param(
    [string[]]$Files = @(),
    [switch]$Check
)
$ErrorActionPreference = "Stop"

function Get-SigningCert {
    if ($env:VITRY_SIGN_THUMBPRINT) {
        $tp = ($env:VITRY_SIGN_THUMBPRINT -replace '[^0-9A-Fa-f]', '').ToUpperInvariant()
        $c = @("Cert:\CurrentUser\My\$tp", "Cert:\LocalMachine\My\$tp") | Where-Object { Test-Path $_ } | ForEach-Object { Get-Item $_ } | Select-Object -First 1
        if (-not $c) { throw "VITRY_SIGN_THUMBPRINT definido, mas o certificado nao esta em CurrentUser\My nem LocalMachine\My." }
        return $c
    }
    if ($env:VITRY_SIGN_PFX) {
        if (-not (Test-Path $env:VITRY_SIGN_PFX)) { throw "VITRY_SIGN_PFX aponta para um arquivo que nao existe." }
        $flags = [Security.Cryptography.X509Certificates.X509KeyStorageFlags]::EphemeralKeySet
        try { return New-Object Security.Cryptography.X509Certificates.X509Certificate2($env:VITRY_SIGN_PFX, $env:VITRY_SIGN_PFX_PASSWORD, $flags) }
        catch { return New-Object Security.Cryptography.X509Certificates.X509Certificate2($env:VITRY_SIGN_PFX, $env:VITRY_SIGN_PFX_PASSWORD) }   # .NET sem EphemeralKeySet
    }
    return $null
}

$cert = Get-SigningCert
if ($Check) { if ($cert) { Write-Host "certificado de assinatura: $($cert.Subject) (vence $($cert.NotAfter.ToString('yyyy-MM-dd')))"; exit 0 } else { exit 1 } }
if (-not $cert) { throw "Nenhum certificado configurado (VITRY_SIGN_THUMBPRINT ou VITRY_SIGN_PFX). Ver README, secao Assinatura." }
if (-not $cert.HasPrivateKey) { throw "O certificado '$($cert.Subject)' nao tem a chave privada acessivel." }
$eku = $cert.Extensions | Where-Object { $_.Oid.Value -eq '2.5.29.37' }
if ($eku -and ($eku.EnhancedKeyUsages | Where-Object { $_.Value -eq '1.3.6.1.5.5.7.3.3' }).Count -eq 0) { throw "O certificado '$($cert.Subject)' nao e de assinatura de codigo (EKU 1.3.6.1.5.5.7.3.3 ausente)." }
if ($cert.NotAfter -lt (Get-Date)) { throw "O certificado venceu em $($cert.NotAfter.ToString('yyyy-MM-dd'))." }
if ($cert.NotAfter -lt (Get-Date).AddDays(30)) { Write-Warning "O certificado vence em $($cert.NotAfter.ToString('yyyy-MM-dd')): renove." }

$ts = $env:VITRY_SIGN_TIMESTAMP; if (-not $ts) { $ts = "http://timestamp.digicert.com" }
foreach ($f in $Files) {
    $path = (Resolve-Path $f).Path
    $sp = @{ FilePath = $path; Certificate = $cert; HashAlgorithm = "SHA256"; IncludeChain = "NotRoot" }
    if ($ts -ne "none") { $sp.TimestampServer = $ts }
    $r = $null
    for ($i = 1; $i -le 3; $i++) {   # o servidor de carimbo as vezes falha: tenta 3 vezes
        $r = Set-AuthenticodeSignature @sp
        if ($r.Status -in @("Valid", "UnknownError") -and $r.SignerCertificate) { break }
        Start-Sleep -Seconds (2 * $i)
    }
    $v = Get-AuthenticodeSignature $path
    if (-not $v.SignerCertificate -or $v.SignerCertificate.Thumbprint -ne $cert.Thumbprint) { throw "assinatura NAO aplicada em $path ($($r.StatusMessage))" }
    if ($ts -ne "none" -and -not $v.TimeStamperCertificate) { throw "assinatura sem carimbo de tempo em $path (servidor $ts falhou 3 vezes)" }
    # Valid = cadeia confiavel. UnknownError = assinatura integra com raiz nao confiavel nesta maquina (ex.: certificado de teste).
    if ($v.Status -ne "Valid") { Write-Warning "$([IO.Path]::GetFileName($path)): assinatura aplicada, mas o Windows diz '$($v.Status)': $($v.StatusMessage)" }
    Write-Host ("assinado: " + [IO.Path]::GetFileName($path) + "  (" + $v.Status + ", " + $(if ($v.TimeStamperCertificate) { "com carimbo" } else { "SEM carimbo" }) + ")")
}
