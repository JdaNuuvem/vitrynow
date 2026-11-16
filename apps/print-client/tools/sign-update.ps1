# Publica um release do print-client (PC-04): gera latest.json (versao, arquivo, SHA-256, tamanho) e
# latest.json.sig (RSA-SHA256, base64) em -OutDir, ao lado do instalador copiado. Suba os TRES arquivos
# para {UpdateBaseUrl} (https). O app so executa o instalador se a assinatura e o hash conferirem.
param(
    [Parameter(Mandatory = $true)][string]$Installer,
    [Parameter(Mandatory = $true)][string]$Version,
    [Parameter(Mandatory = $true)][string]$PrivateKeyFile,
    [Parameter(Mandatory = $true)][string]$OutDir,
    [switch]$SkipVersionCheck   # so se o instalador nao carrega a versao no recurso de versao do .exe
)
$ErrorActionPreference = "Stop"
if ($Version -notmatch '^\d{1,5}(\.\d{1,5}){1,3}$') { throw "Versao invalida: $Version (use 1.2.3)" }
$inst = Get-Item -LiteralPath $Installer
if ($inst.Extension -ne ".exe") { throw "O instalador precisa ser .exe" }
if ($inst.Name -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\.exe$') { throw "Nome do instalador so pode ter letras, numeros, ponto, - e _ (sem espacos): $($inst.Name)" }
if ($inst.Length -gt 200MB) { throw "Instalador maior que 200 MB" }
if (-not $SkipVersionCheck) {
    # A versao anunciada tem de ser a do .exe: evita assinar o instalador velho com numero novo (ou o contrario).
    $fv = $inst.VersionInfo.FileVersion
    $norm = { param($v) (($v -replace '[^0-9.]', '').Trim('.') -replace '(\.0)+$', '') }
    if (-not $fv -or (& $norm $fv) -ne (& $norm $Version)) { throw "Versao do .exe ('$fv') diferente de -Version '$Version'. Corrija o instalador ou use -SkipVersionCheck conscientemente." }
}
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
    $oid = [Security.Cryptography.CryptoConfig]::MapNameToOID("SHA256")
    $raw = $rsa.SignData($bytes, $oid)
    # Reverifica o que acabou de assinar (so com a parte publica da chave): pega chave/arquivo errados antes de publicar.
    $pubOnly = New-Object System.Security.Cryptography.RSACryptoServiceProvider; $pubOnly.PersistKeyInCsp = $false
    try { $pubOnly.FromXmlString($rsa.ToXmlString($false)); if (-not $pubOnly.VerifyData($bytes, $oid, $raw)) { throw "A assinatura gerada nao confere com a chave publica." } } finally { $pubOnly.Dispose() }
    $sig = [Convert]::ToBase64String($raw)
} finally { $rsa.Dispose() }
[IO.File]::WriteAllBytes((Join-Path $OutDir "latest.json"), $bytes)
[IO.File]::WriteAllText((Join-Path $OutDir "latest.json.sig"), $sig, [Text.Encoding]::ASCII)
Write-Host "Release $Version pronto em $OutDir : latest.json, latest.json.sig, $($inst.Name)" -ForegroundColor Green
Write-Host "SHA256 $hash"
