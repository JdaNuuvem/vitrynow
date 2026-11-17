# Testes da chave de release com senha (PC-13): roda new-update-key.ps1 / sign-update.ps1 / verify-release.ps1 de verdade em
# uma pasta temporaria e confere os caminhos felizes e de erro. Chaves e senhas sao DESCARTAVEIS (geradas aqui, apagadas no fim).
# Sai com 0 so se tudo passar.   .\tools\test-keyfile.ps1 [-RoslynDir <pasta com tasks\net472\csc.exe>]
param([string]$RoslynDir = "")
$ErrorActionPreference = "Stop"
$here = $PSScriptRoot
. (Join-Path $here "keyfile.ps1")
$fails = 0
function Check([string]$label, [bool]$cond) { if ($cond) { Write-Host "PASS $label" } else { Write-Host "FAIL $label"; $script:fails++ } }
function SS([string]$t) { $s = New-Object Security.SecureString; $t.ToCharArray() | ForEach-Object { $s.AppendChar($_) }; $s.MakeReadOnly(); $s }
function Throws([scriptblock]$b) { try { & $b | Out-Null; return $null } catch { return $_.Exception.Message } }

$w = Join-Path ([IO.Path]::GetTempPath()) ("pc_keytest_" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory $w | Out-Null
try {
    $good = SS "uma-senha-bem-longa-123"; $bad = SS "senha-errada-123456"
    $demo = '<RSAKeyValue><Modulus>teste</Modulus></RSAKeyValue>'

    # --- formato e criptografia (rapido: 100 000 iteracoes, o minimo aceito)
    $blob = Protect-KeyXml $demo $good 100000
    Check "formato: magic MCUK, versao 2, iteracoes gravadas" ([Text.Encoding]::ASCII.GetString($blob[0..3]) -eq "MCUK" -and $blob[4] -eq 2 -and [BitConverter]::ToInt32([byte[]]($blob[8..5]), 0) -eq 100000)
    Check "formato: ida e volta devolve o mesmo XML" ((Unprotect-KeyXml $blob $good) -eq $demo)
    Check "formato: o texto puro NAO aparece no arquivo" (-not [Text.Encoding]::UTF8.GetString($blob).Contains("RSAKeyValue"))
    $blob2 = Protect-KeyXml $demo $good 100000
    Check "formato: sal e IV aleatorios (duas cifragens do mesmo XML diferem)" (-not (Test-ConstantTimeEqual $blob $blob2))
    Check "senha errada falha sem decifrar" ((Throws { Unprotect-KeyXml $blob $bad }) -match "Senha incorreta")
    $t = [byte[]]$blob.Clone(); $t[45] = $t[45] -bxor 1
    Check "texto cifrado adulterado (1 bit) falha" ((Throws { Unprotect-KeyXml $t $good }) -match "adulterado")
    $t = [byte[]]$blob.Clone(); $t[$t.Length - 1] = $t[$t.Length - 1] -bxor 1
    Check "MAC adulterado falha" ((Throws { Unprotect-KeyXml $t $good }) -match "adulterado")
    $t = [byte[]]$blob.Clone(); $t[7] = 0; $t[8] = 1
    Check "iteracoes adulteradas no cabecalho falham (MAC cobre o cabecalho / faixa minima)" ($null -ne (Throws { Unprotect-KeyXml $t $good }))
    $t = [byte[]]$blob.Clone(); $t[4] = 9
    Check "versao desconhecida e recusada" ((Throws { Unprotect-KeyXml $t $good }) -match "Versao")
    $t = [byte[]]$blob.Clone(); $t[4] = 1
    Check "formato v1 (derivacao fraca) e recusado com mensagem clara para gerar de novo" ((Throws { Unprotect-KeyXml $t $good }) -match "v1")
    # K1: chaves de cifra e de MAC diferentes e deterministicas para a mesma senha/sal; mudar o sal muda as duas
    $pw1 = ConvertTo-PasswordBytes $good; $salt = [byte[]](1..16); $salt2 = [byte[]](2..17)
    $k = Get-DerivedKeys $pw1 $salt 100000; $kSame = Get-DerivedKeys $pw1 $salt 100000; $kSalt = Get-DerivedKeys $pw1 $salt2 100000
    $enc = [byte[]]$k[0..31]; $mac = [byte[]]$k[32..63]
    Check "K1: chave de cifra e chave de MAC sao diferentes (separacao por HMAC)" (-not (Test-ConstantTimeEqual $enc $mac))
    Check "K1: derivacao e deterministica e muda com o sal" ((Test-ConstantTimeEqual ([byte[]]$k) ([byte[]]$kSame)) -and -not (Test-ConstantTimeEqual ([byte[]]$k) ([byte[]]$kSalt)))
    $kdf = New-Object Security.Cryptography.Rfc2898DeriveBytes($pw1, $salt, 100000, [Security.Cryptography.HashAlgorithmName]::SHA256); $firstBlock = $kdf.GetBytes(32); $kdf.Dispose()
    Check "K1: a chave AES nao e o 1o bloco do PBKDF2 (nao da para testar palpite pelo 1o bloco)" (-not (Test-ConstantTimeEqual $enc $firstBlock) -and -not (Test-ConstantTimeEqual $mac $firstBlock))
    # K1, teste INDEPENDENTE do codigo: recalcula o PBKDF2 aqui e confere o arquivo gerado (nao depende de Get-DerivedKeys)
    $blobK = Protect-KeyXml $demo $good 100000
    $saltK = [byte[]]$blobK[9..24]
    $bodyK = New-Object byte[] ($blobK.Length - 32); [Array]::Copy($blobK, 0, $bodyK, 0, $bodyK.Length)
    $tagK = New-Object byte[] 32; [Array]::Copy($blobK, $blobK.Length - 32, $tagK, 0, 32)
    $pwK = ConvertTo-PasswordBytes $good
    Check "armadilha do PowerShell: a senha em bytes e byte[] de verdade (nao object[])" ($pwK -is [byte[]])
    $kdf64 = New-Object Security.Cryptography.Rfc2898DeriveBytes($pwK, $saltK, 100000, [Security.Cryptography.HashAlgorithmName]::SHA256); $t64 = $kdf64.GetBytes(64); $kdf64.Dispose()
    $masterK = [byte[]]$t64[0..31]
    $hmK = New-Object Security.Cryptography.HMACSHA256(, $masterK); $macK2 = $hmK.ComputeHash([Text.Encoding]::ASCII.GetBytes("mac")); $hmK.Dispose()
    $h2 = New-Object Security.Cryptography.HMACSHA256(, $macK2); $tagV2 = $h2.ComputeHash($bodyK); $h2.Dispose()
    Check "K1 (independente): o MAC do arquivo e HMAC(HMAC(PBKDF2 de 32 bytes, 'mac'), corpo): o formato v2 segue a especificacao" (Test-ConstantTimeEqual $tagK $tagV2)
    $macV1 = [byte[]]$t64[32..63]
    $h1 = New-Object Security.Cryptography.HMACSHA256(, $macV1); $tagV1 = $h1.ComputeHash($bodyK); $h1.Dispose()
    Check "K1 (independente): o MAC NAO e o do formato v1 (2o bloco do PBKDF2): quem acerta o 1o bloco nao valida nada" (-not (Test-ConstantTimeEqual $tagK $tagV1))
    $h0 = New-Object Security.Cryptography.HMACSHA256(, ([byte[]]$t64[0..31])); $tagFirst = $h0.ComputeHash($bodyK); $h0.Dispose()
    Check "K1 (independente): o MAC tambem nao e calculado direto com o 1o bloco" (-not (Test-ConstantTimeEqual $tagK $tagFirst))
    [Array]::Clear($pwK, 0, $pwK.Length)
    [Array]::Clear($pw1, 0, $pw1.Length)
    Check "arquivo truncado e recusado" ($null -ne (Throws { Unprotect-KeyXml ([byte[]]$blob[0..60]) $good }))
    Check "lixo e recusado" ($null -ne (Throws { Unprotect-KeyXml ([byte[]](1..200)) $good }))
    Check "senha curta (menos de 12) e recusada" ((Throws { Protect-KeyXml $demo (SS "curta") 100000 }) -match "pelo menos")
    Check "iteracoes baixas demais sao recusadas" ((Throws { Protect-KeyXml $demo $good 1000 }) -match "minimo")

    # --- scripts de ponta a ponta (senha por objeto SecureString em memoria; nunca na linha de comando)
    $key = Join-Path $w "k1.updkey"
    $out = & (Join-Path $here "new-update-key.ps1") -OutPrivate $key -KeyId k1 -PasswordSecure $good *>&1   # *>&1: inclui o Write-Host
    Check "new-update-key: cria arquivo cifrado (MCUK) e imprime a chave publica" ((Test-KeyFileProtected $key) -and (($out | Out-String) -match "TrustedKey"))
    Check "new-update-key: nao sobrescreve sem -Force" ($null -ne (Throws { & (Join-Path $here "new-update-key.ps1") -OutPrivate $key -PasswordSecure $good }))
    Check "new-update-key: senha curta nao grava nada" ((Throws { & (Join-Path $here "new-update-key.ps1") -OutPrivate (Join-Path $w "x.updkey") -PasswordSecure (SS "curta") }) -ne $null -and -not (Test-Path (Join-Path $w "x.updkey")))
    Check "new-update-key: chave dentro do repositorio e recusada" ($null -ne (Throws { & (Join-Path $here "new-update-key.ps1") -OutPrivate (Join-Path (Split-Path -Parent $here) "k.updkey") -PasswordSecure $good }))
    $ErrorActionPreference = "Continue"   # o filho escreve erro em stderr (esperado); com Stop o 2>&1 derrubaria ESTE script
    $semConsole = & powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $here "new-update-key.ps1") -OutPrivate (Join-Path $w "sem.updkey") 2>&1 | Out-String
    $ErrorActionPreference = "Stop"
    Check "new-update-key: sem console e sem -NoPassword FALHA (nunca grava texto puro em silencio)" (-not (Test-Path (Join-Path $w "sem.updkey")))

    $installer = Join-Path $w "Setup-1.2.0.exe"
    [IO.File]::WriteAllBytes($installer, [byte[]](1..4000 | ForEach-Object { $_ % 251 }))
    $rel = Join-Path $w "rel"
    & (Join-Path $here "sign-update.ps1") -Installer $installer -Version 1.2.0 -PrivateKeyFile $key -KeyId k1 -OutDir $rel -SkipVersionCheck -PasswordSecure $good | Out-Null
    Check "sign-update: senha certa assina (latest.json e .sig)" ((Test-Path (Join-Path $rel "latest.json")) -and (Test-Path (Join-Path $rel "latest.json.sig")))
    $rel2 = Join-Path $w "rel2"
    Check "sign-update: senha errada NAO gera release" (($null -ne (Throws { & (Join-Path $here "sign-update.ps1") -Installer $installer -Version 1.2.0 -PrivateKeyFile $key -KeyId k1 -OutDir $rel2 -SkipVersionCheck -PasswordSecure $bad })) -and -not (Test-Path (Join-Path $rel2 "latest.json")))
    # o release assinado passa no MESMO codigo de decisao do app
    $xml = Unprotect-KeyXml ([IO.File]::ReadAllBytes($key)) $good
    $r = New-Object Security.Cryptography.RSACryptoServiceProvider; $r.PersistKeyInCsp = $false; $r.FromXmlString($xml)
    $pub = Join-Path $w "k1.pub.xml"; [IO.File]::WriteAllText($pub, $r.ToXmlString($false)); $r.Dispose(); $xml = $null
    $verifyArgs = @{ ReleaseDir = $rel; Key = @("k1=$pub"); CurrentVersion = "1.0.0" }
    if ($RoslynDir) { $verifyArgs.RoslynDir = $RoslynDir }
    & (Join-Path $here "verify-release.ps1") @verifyArgs | Out-Null
    Check "verify-release: o release assinado com a chave cifrada e aceito pelo codigo do app" ($LASTEXITCODE -eq 0)
    # chave em texto puro: gera so com -NoPassword (aviso), e o sign-update RECUSA por padrao (K2)
    $plain = Join-Path $w "plain.xml"
    & (Join-Path $here "new-update-key.ps1") -OutPrivate $plain -KeyId k2 -NoPassword 3>$null | Out-Null
    Check "-NoPassword: grava XML puro (escolha consciente)" ((-not (Test-KeyFileProtected $plain)) -and ((Get-Content $plain -Raw) -match "RSAKeyValue"))
    $relP = Join-Path $w "relP"
    Check "K2: sign-update RECUSA chave em texto puro por padrao e nao gera release" (((Throws { & (Join-Path $here "sign-update.ps1") -Installer $installer -Version 1.2.0 -PrivateKeyFile $plain -KeyId k2 -OutDir $relP -SkipVersionCheck }) -match "TEXTO PURO") -and -not (Test-Path (Join-Path $relP "latest.json")))
    $relQ = Join-Path $w "relQ"
    & (Join-Path $here "sign-update.ps1") -Installer $installer -Version 1.2.0 -PrivateKeyFile $plain -KeyId k2 -OutDir $relQ -SkipVersionCheck -AllowPlainKey 3>$null | Out-Null
    Check "K2: com -AllowPlainKey (consciente) assina, com aviso" (Test-Path (Join-Path $relQ "latest.json"))
} finally {
    Get-ChildItem $w -Recurse -File -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
    Remove-Item $w -Recurse -Force -ErrorAction SilentlyContinue
}
Write-Host ""
if ($fails -eq 0) { Write-Host "TEST_KEYFILE_OK" -ForegroundColor Green; exit 0 }
Write-Host "TEST_KEYFILE_FALHAS=$fails" -ForegroundColor Red; exit 1
