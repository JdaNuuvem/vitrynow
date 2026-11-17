# Publica um release do print-client (PC-04/PC-11): gera latest.json (versao, arquivo, SHA-256, tamanho, keyId,
# issuedAt, validUntil, minVersion, revokeKeys) e latest.json.sig (RSA-SHA256, base64) em -OutDir, ao lado do
# instalador copiado. Suba os TRES arquivos para {UpdateBaseUrl} (https). O app so executa o instalador se a
# assinatura, o keyId, a validade e o hash conferirem. A chave privada e SO do Claudio (CL-10): rode isto na
# maquina dele, com a chave extraida para uma pasta temporaria fora do repositorio (e apague depois).
param(
    [Parameter(Mandatory = $true)][string]$Installer,
    [Parameter(Mandatory = $true)][string]$Version,
    [Parameter(Mandatory = $true)][string]$PrivateKeyFile,
    [Parameter(Mandatory = $true)][string]$OutDir,
    [Parameter(Mandatory = $true)][string]$KeyId,        # k1 = primaria, k2 = reserva offline (a mesma ordem de UpdateKeys.Trusted)
    [int]$ValidDays = 60,                                # janela do manifesto; vencido => o app diz "nao consegui confirmar"
    [string]$MinVersion = "",                            # abaixo dela o app avisa que a atualizacao e obrigatoria
    [string[]]$RevokeKeys = @(),                         # SO a reserva (k2) revoga chaves anteriores (ex.: -RevokeKeys k1)
    [Security.SecureString]$PasswordSecure,              # so para testes (objeto em memoria); a senha NUNCA vai na linha de comando
    [switch]$AllowPlainKey,                              # so se voce SABE que a chave esta em texto puro (desaconselhado)
    [switch]$SkipVersionCheck                            # so se o instalador nao carrega a versao no recurso de versao do .exe
)
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "keyfile.ps1")
$verRx = '^\d{1,5}(\.\d{1,5}){1,3}$'
if ($Version -notmatch $verRx) { throw "Versao invalida: $Version (use 1.2.3)" }
if ($MinVersion -and $MinVersion -notmatch $verRx) { throw "MinVersion invalida: $MinVersion" }
if ($KeyId -notmatch '^[A-Za-z0-9_-]{1,32}$') { throw "KeyId invalido: $KeyId" }
foreach ($k in $RevokeKeys) { if ($k -notmatch '^[A-Za-z0-9_-]{1,32}$' -or $k -eq $KeyId) { throw "RevokeKeys invalido: $k" } }
if ($RevokeKeys.Count -gt 8) { throw "No maximo 8 chaves em -RevokeKeys" }
if ($ValidDays -lt 1 -or $ValidDays -gt 400) { throw "ValidDays deve ficar entre 1 e 400" }
$inst = Get-Item -LiteralPath $Installer
if ($inst.Extension -ne ".exe") { throw "O instalador precisa ser .exe" }
if ($inst.Name -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\.exe$') { throw "Nome do instalador so pode ter letras, numeros, ponto, - e _ (sem espacos): $($inst.Name)" }
if ($inst.BaseName -match '^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])$') { throw "Nome reservado do Windows: $($inst.Name)" }
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
$now = [DateTime]::UtcNow
$fmt = "yyyy-MM-dd'T'HH:mm:ss'Z'"
$issued = $now.ToString($fmt, [Globalization.CultureInfo]::InvariantCulture)
$until = $now.AddDays($ValidDays).ToString($fmt, [Globalization.CultureInfo]::InvariantCulture)
$json = '{"version":"' + $Version + '","file":"' + $inst.Name + '","sha256":"' + $hash + '","size":' + (Get-Item $dest).Length +
        ',"keyId":"' + $KeyId + '","issuedAt":"' + $issued + '","validUntil":"' + $until + '"'
if ($MinVersion) { $json += ',"minVersion":"' + $MinVersion + '"' }
if ($RevokeKeys.Count -gt 0) { $json += ',"revokeKeys":[' + (($RevokeKeys | ForEach-Object { '"' + $_ + '"' }) -join ',') + ']' }
$json += '}'
$bytes = (New-Object Text.UTF8Encoding($false)).GetBytes($json)
$rsa = New-Object System.Security.Cryptography.RSACryptoServiceProvider
$rsa.PersistKeyInCsp = $false
try {
    # Chave cifrada (.updkey, PC-13): pede a senha por prompt seguro e decifra so em memoria. Chave em texto puro (.xml antigo) ainda abre.
    $keyXml = $null
    if (Test-KeyFileProtected $PrivateKeyFile) {
        $pw = if ($PasswordSecure) { $PasswordSecure } else { Read-Host -AsSecureString "Senha da chave de release" }
        $keyXml = Unprotect-KeyXml ([IO.File]::ReadAllBytes($PrivateKeyFile)) $pw
    } else {
        # K2 (Nightingale): chave em texto puro e RECUSADA por padrao; quem copiou o arquivo publica atualizacoes.
        if (-not $AllowPlainKey) { throw "A chave '$PrivateKeyFile' esta em TEXTO PURO (sem senha). Gere de novo com new-update-key.ps1 (com senha) e apague este arquivo. Para assinar mesmo assim, use -AllowPlainKey (desaconselhado)." }
        Write-Warning "Assinando com chave em TEXTO PURO ($PrivateKeyFile): apague-a e gere uma com senha."
        $keyXml = [IO.File]::ReadAllText($PrivateKeyFile)
    }
    $rsa.FromXmlString($keyXml)
    $keyXml = $null   # a chave ja esta no objeto RSA; solta a string (o .NET nao permite apagar o conteudo da memoria)
    if ($rsa.KeySize -lt 3072) { throw "Chave de $($rsa.KeySize) bits: o app exige 3072 ou mais." }
    $oid = [Security.Cryptography.CryptoConfig]::MapNameToOID("SHA256")
    $raw = $rsa.SignData($bytes, $oid)
    # Reverifica o que acabou de assinar (so com a parte publica da chave): pega chave/arquivo errados antes de publicar.
    $pubOnly = New-Object System.Security.Cryptography.RSACryptoServiceProvider; $pubOnly.PersistKeyInCsp = $false
    try { $pubOnly.FromXmlString($rsa.ToXmlString($false)); if (-not $pubOnly.VerifyData($bytes, $oid, $raw)) { throw "A assinatura gerada nao confere com a chave publica." } } finally { $pubOnly.Dispose() }
    $sig = [Convert]::ToBase64String($raw)
} finally { $rsa.Dispose(); [GC]::Collect() }
[IO.File]::WriteAllBytes((Join-Path $OutDir "latest.json"), $bytes)
[IO.File]::WriteAllText((Join-Path $OutDir "latest.json.sig"), $sig, [Text.Encoding]::ASCII)
Write-Host "Release $Version (chave $KeyId, valido ate $until) pronto em $OutDir : latest.json, latest.json.sig, $($inst.Name)" -ForegroundColor Green
Write-Host "SHA256 $hash"
Write-Host "Confira antes de subir: .\tools\verify-release.ps1 -ReleaseDir $OutDir -Key $KeyId=<arquivo-da-chave-publica.xml>   (sem -Key usa as chaves embutidas)"
