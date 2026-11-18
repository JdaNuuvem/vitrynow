# Arquivo de chave privada de release PROTEGIDO POR SENHA (PC-13). Usado por new-update-key.ps1 e sign-update.ps1.
#
# Formato versionado ".updkey" (binario):
#   "MCUK" | versao(1 byte = 2) | iteracoes PBKDF2 (4 bytes, big-endian) | sal (16) | IV (16) | texto cifrado | HMAC-SHA256 (32)
#   - UMA derivacao PBKDF2-HMAC-SHA256 (600 000 iteracoes por padrao) de 32 bytes = chave MESTRA; dela saem, por
#     HMAC-SHA256(mestra, "enc") e HMAC-SHA256(mestra, "mac"), a chave AES-256 e a chave do HMAC (separacao de dominio).
#     (A versao 1 pedia 64 bytes ao PBKDF2: o atacante testava palpites so com o 1o bloco de 32 bytes, metade das
#     iteracoes. A v1 nunca guardou chave real e NAO e mais aceita: gere o arquivo de novo.)
#   - AES-256-CBC + HMAC-SHA256 sobre (cabecalho | IV | texto cifrado) ("cifrar e depois autenticar"); o MAC e conferido em
#     tempo constante ANTES de decifrar, entao senha errada ou arquivo adulterado falha sem decifrar nada.
#   (O .NET Framework 4.7.2 nao tem AES-GCM; CBC + HMAC e o equivalente seguro disponivel.)
# A senha NUNCA vai em argumento de linha de comando nem em variavel de ambiente: vem por prompt seguro (Read-Host
# -AsSecureString) ou, em teste, por um objeto SecureString passado em memoria. Limite honesto: o XML decifrado vira uma
# string do .NET, que o PowerShell nao consegue apagar da memoria; os buffers de bytes e a chave derivada sao zerados.

$script:KeyMagic = [Text.Encoding]::ASCII.GetBytes("MCUK")
$script:KeyVersion = 2
$script:KeyDefaultIterations = 600000
$script:KeyMinPasswordLength = 12

function ConvertTo-PasswordBytes([Security.SecureString]$secure) {
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
        $chars = New-Object char[] $secure.Length
        [Runtime.InteropServices.Marshal]::Copy($bstr, $chars, 0, $chars.Length)
        # A virgula mantem byte[] de verdade: sem ela o PowerShell solta os bytes no pipeline e quem recebe ganha um object[]
        # (e o PBKDF2 escolheria a sobrecarga de senha em TEXTO, calculando outra coisa).
        try { return , [Text.Encoding]::UTF8.GetBytes($chars) } finally { [Array]::Clear($chars, 0, $chars.Length) }
    } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

function Get-PasswordLength([Security.SecureString]$secure) { return $secure.Length }

function Read-NewPassword {
    # Pede duas vezes e confere; exige tamanho minimo. Falha (sem texto puro) se nao houver console.
    $a = Read-Host -AsSecureString "Senha da chave de release (minimo $script:KeyMinPasswordLength caracteres)"
    $b = Read-Host -AsSecureString "Repita a senha"
    $pa = ConvertTo-PasswordBytes $a; $pb = ConvertTo-PasswordBytes $b
    try {
        if (-not (Test-ConstantTimeEqual $pa $pb)) { throw "As senhas nao conferem." }
    } finally { [Array]::Clear($pa, 0, $pa.Length); [Array]::Clear($pb, 0, $pb.Length) }
    return $a
}

function Test-ConstantTimeEqual([byte[]]$x, [byte[]]$y) {
    if ($x.Length -ne $y.Length) { return $false }
    $diff = 0
    for ($i = 0; $i -lt $x.Length; $i++) { $diff = $diff -bor ($x[$i] -bxor $y[$i]) }
    return ($diff -eq 0)
}

function Get-DerivedKeys([byte[]]$passwordBytes, [byte[]]$salt, [int]$iterations) {
    # Chave mestra de 32 bytes (um unico bloco do PBKDF2: o atacante paga TODAS as iteracoes por palpite).
    $kdf = New-Object Security.Cryptography.Rfc2898DeriveBytes($passwordBytes, $salt, $iterations, [Security.Cryptography.HashAlgorithmName]::SHA256)
    $master = $null
    try {
        $master = $kdf.GetBytes(32)
        $hm = New-Object Security.Cryptography.HMACSHA256(, $master)
        try {
            $enc = $hm.ComputeHash([Text.Encoding]::ASCII.GetBytes("enc"))
            $mac = $hm.ComputeHash([Text.Encoding]::ASCII.GetBytes("mac"))
        } finally { $hm.Dispose() }
        $both = New-Object byte[] 64
        [Array]::Copy($enc, 0, $both, 0, 32); [Array]::Copy($mac, 0, $both, 32, 32)
        [Array]::Clear($enc, 0, 32); [Array]::Clear($mac, 0, 32)
        return , $both
    } finally { $kdf.Dispose(); if ($master) { [Array]::Clear($master, 0, $master.Length) } }
}

function Test-KeyFileProtected([string]$path) {
    $head = New-Object byte[] 4
    $fs = [IO.File]::OpenRead($path)
    try { [void]$fs.Read($head, 0, 4) } finally { $fs.Dispose() }
    return (Test-ConstantTimeEqual $head $script:KeyMagic)
}

function Protect-KeyXml([string]$xml, [Security.SecureString]$password, [int]$iterations = $script:KeyDefaultIterations) {
    if ($password.Length -lt $script:KeyMinPasswordLength) { throw "A senha precisa ter pelo menos $script:KeyMinPasswordLength caracteres." }
    if ($iterations -lt 100000) { throw "Iteracoes PBKDF2 abaixo do minimo (100000)." }
    $rng = New-Object Security.Cryptography.RNGCryptoServiceProvider
    $salt = New-Object byte[] 16; $iv = New-Object byte[] 16
    $rng.GetBytes($salt); $rng.GetBytes($iv); $rng.Dispose()
    $pw = ConvertTo-PasswordBytes $password
    $keys = $null; $plain = [Text.Encoding]::UTF8.GetBytes($xml)
    try {
        $keys = Get-DerivedKeys $pw $salt $iterations
        $encKey = New-Object byte[] 32; $macKey = New-Object byte[] 32
        [Array]::Copy($keys, 0, $encKey, 0, 32); [Array]::Copy($keys, 32, $macKey, 0, 32)
        $aes = [Security.Cryptography.Aes]::Create(); $aes.KeySize = 256; $aes.Mode = [Security.Cryptography.CipherMode]::CBC; $aes.Padding = [Security.Cryptography.PaddingMode]::PKCS7
        $aes.Key = $encKey; $aes.IV = $iv
        $enc = $aes.CreateEncryptor(); $cipher = $enc.TransformFinalBlock($plain, 0, $plain.Length); $enc.Dispose(); $aes.Dispose()
        $it = [BitConverter]::GetBytes([int]$iterations); [Array]::Reverse($it)
        $ms = New-Object IO.MemoryStream
        $ms.Write($script:KeyMagic, 0, 4); $ms.WriteByte([byte]$script:KeyVersion); $ms.Write($it, 0, 4)
        $ms.Write($salt, 0, 16); $ms.Write($iv, 0, 16); $ms.Write($cipher, 0, $cipher.Length)
        $body = $ms.ToArray()
        $hmac = New-Object Security.Cryptography.HMACSHA256(, $macKey)
        $tag = $hmac.ComputeHash($body); $hmac.Dispose()
        $out = New-Object byte[] ($body.Length + 32)
        [Array]::Copy($body, 0, $out, 0, $body.Length); [Array]::Copy($tag, 0, $out, $body.Length, 32)
        [Array]::Clear($encKey, 0, 32); [Array]::Clear($macKey, 0, 32)
        return , $out
    } finally {
        [Array]::Clear($pw, 0, $pw.Length); [Array]::Clear($plain, 0, $plain.Length)
        if ($keys) { [Array]::Clear($keys, 0, $keys.Length) }
    }
}

function Unprotect-KeyXml([byte[]]$blob, [Security.SecureString]$password) {
    # Cabecalho minimo: 4+1+4+16+16 + 16 (um bloco) + 32 (MAC)
    if ($blob.Length -lt 89 -or -not (Test-ConstantTimeEqual $blob[0..3] $script:KeyMagic)) { throw "Arquivo de chave invalido (nao e um .updkey do MeuCardapio)." }
    if ($blob[4] -eq 1) { throw "Arquivo de chave no formato v1 (so de teste, derivacao fraca): gere a chave de novo com new-update-key.ps1." }
    if ($blob[4] -ne $script:KeyVersion) { throw "Versao do arquivo de chave nao suportada: $($blob[4])." }
    $itBytes = $blob[5..8]; [Array]::Reverse($itBytes)
    $iterations = [BitConverter]::ToInt32([byte[]]$itBytes, 0)
    if ($iterations -lt 100000 -or $iterations -gt 20000000) { throw "Iteracoes PBKDF2 fora da faixa aceita: $iterations." }
    $salt = [byte[]]$blob[9..24]; $iv = [byte[]]$blob[25..40]
    $cipherLen = $blob.Length - 41 - 32
    if ($cipherLen -le 0 -or ($cipherLen % 16) -ne 0) { throw "Arquivo de chave corrompido." }
    $cipher = New-Object byte[] $cipherLen; [Array]::Copy($blob, 41, $cipher, 0, $cipherLen)
    $tag = New-Object byte[] 32; [Array]::Copy($blob, $blob.Length - 32, $tag, 0, 32)
    $body = New-Object byte[] ($blob.Length - 32); [Array]::Copy($blob, 0, $body, 0, $body.Length)
    $pw = ConvertTo-PasswordBytes $password
    $keys = $null
    try {
        $keys = Get-DerivedKeys $pw $salt $iterations
        $encKey = New-Object byte[] 32; $macKey = New-Object byte[] 32
        [Array]::Copy($keys, 0, $encKey, 0, 32); [Array]::Copy($keys, 32, $macKey, 0, 32)
        $hmac = New-Object Security.Cryptography.HMACSHA256(, $macKey)
        $calc = $hmac.ComputeHash($body); $hmac.Dispose()
        # MAC ANTES de decifrar: senha errada e arquivo adulterado sao indistinguiveis e nada e decifrado.
        if (-not (Test-ConstantTimeEqual $calc $tag)) { throw "Senha incorreta ou arquivo de chave adulterado." }
        $aes = [Security.Cryptography.Aes]::Create(); $aes.KeySize = 256; $aes.Mode = [Security.Cryptography.CipherMode]::CBC; $aes.Padding = [Security.Cryptography.PaddingMode]::PKCS7
        $aes.Key = $encKey; $aes.IV = $iv
        $dec = $aes.CreateDecryptor(); $plain = $dec.TransformFinalBlock($cipher, 0, $cipher.Length); $dec.Dispose(); $aes.Dispose()
        try { return [Text.Encoding]::UTF8.GetString($plain) } finally { [Array]::Clear($plain, 0, $plain.Length) }
    } finally {
        [Array]::Clear($pw, 0, $pw.Length)
        if ($keys) { [Array]::Clear($keys, 0, $keys.Length) }
    }
}
