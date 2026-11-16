# Publica um release do print-client (PC-04): gera latest.json (versao, arquivo, SHA-256, tamanho) e
# latest.json.sig (RSA-SHA256, base64) em -OutDir, ao lado do instalador copiado. Suba os TRES arquivos
# para {UpdateBaseUrl} (https). O app so executa o instalador se a assinatura e o hash conferirem.
param(
    [Parameter(Mandatory = $true)][string]$Installer,
    [Parameter(Mandatory = $true)][string]$Version,
    [Parameter(Mandatory = $true)][string]$PrivateKeyFile,
    [Parameter(Mandatory = $true)][string]$OutDir
)
$ErrorActionPreference = "Stop"
if ($Version -notmatch '^\d{1,5}(\.\d{1,5}){1,3}$') { throw "Versao invalida: $Version (use 1.2.3)" }
$inst = Get-Item -LiteralPath $Installer
if ($inst.Extension -ne ".exe") { throw "O instalador precisa ser .exe" }
if ($inst.Name -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\.exe$') { throw "Nome do instalador so pode ter letras, numeros, ponto, - e _ (sem espacos): $($inst.Name)" }
if ($inst.Length -gt 200MB) { throw "Instalador maior que 200 MB" }
New-Item -ItemType Directory -Force $OutDir | Out-Null
$dest = Join-Path $OutDir $inst.Name
Copy-Item -LiteralPath $inst.FullName -Destination $dest -Force
$hash = (Get-FileHash $dest -Algorithm SHA256).Hash
$json = '{"version":"' + $Version + '","file":"' + $inst.Name + '","sha256":"' + $hash + '","size":' + (Get-Item $dest).Length + '}'
$bytes = (New-Object Text.UTF8Encoding($false)).GetBytes($json)
$rsa = New-Object System.Security.Cryptography.RSACryptoServiceProvider
$rsa.PersistKeyInCsp = $false
try {
    $rsa.FromXmlString([IO.File]::ReadAllText($PrivateKeyFile))
    if ($rsa.KeySize -lt 3072) { throw "Chave de $($rsa.KeySize) bits: o app exige 3072 ou mais." }
    $sig = [Convert]::ToBase64String($rsa.SignData($bytes, [Security.Cryptography.CryptoConfig]::MapNameToOID("SHA256")))
} finally { $rsa.Dispose() }
[IO.File]::WriteAllBytes((Join-Path $OutDir "latest.json"), $bytes)
[IO.File]::WriteAllText((Join-Path $OutDir "latest.json.sig"), $sig, [Text.Encoding]::ASCII)
Write-Host "Release $Version pronto em $OutDir : latest.json, latest.json.sig, $($inst.Name)" -ForegroundColor Green
Write-Host "SHA256 $hash"
