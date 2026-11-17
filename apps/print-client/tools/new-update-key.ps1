# Gera um par de chaves de ASSINATURA DE RELEASE do auto-update (RSA 3072, SHA-256) - PC-04/PC-11/PC-13.
#   - A chave PRIVADA fica FORA do repositorio (-OutPrivate), por padrao CIFRADA com senha (formato .updkey, ver
#     tools\keyfile.ps1: PBKDF2 600 000 iteracoes + AES-256 + HMAC). A senha e pedida por prompt seguro, DUAS vezes; nunca
#     vai em argumento de linha de comando nem em variavel de ambiente. Sem console para o prompt, o script FALHA: nao
#     existe texto puro silencioso.
#   - -NoPassword grava o XML em texto puro (so permissao do seu usuario Windows): escolha consciente, com aviso.
#   - A chave PUBLICA (XML) e impressa ja no formato de Services\UpdateKeys.cs; gere DUAS (k1 primaria e k2 reserva
#     offline), cole as duas na lista Trusted e gere um novo build. Quem gera, guarda e assina e o Claudio (CL-10);
#     nenhum agente guarda a privada nem a senha. Veja nightingale\guia-chave-release.md.
param(
    [Parameter(Mandatory = $true)][string]$OutPrivate,
    [string]$KeyId = "k1",
    [switch]$NoPassword,
    [switch]$Force,
    [Security.SecureString]$PasswordSecure   # so para testes automatizados (objeto em memoria, nunca texto na linha de comando)
)
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "keyfile.ps1")
if ($KeyId -notmatch '^[A-Za-z0-9_-]{1,32}$') { throw "KeyId invalido: $KeyId" }
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
$full = [IO.Path]::GetFullPath($OutPrivate)
if ($full.StartsWith($repo, [StringComparison]::OrdinalIgnoreCase)) { throw "A chave privada nao pode ficar dentro do repositorio ($repo). Escolha uma pasta fora dele." }
if ((Test-Path $full) -and -not $Force) { throw "$full ja existe (use -Force para sobrescrever; isso invalida as atualizacoes assinadas com a chave antiga)." }
if ($NoPassword -and $PasswordSecure) { throw "Use -NoPassword OU senha, nao os dois." }

# A senha e pedida ANTES de gerar a chave: se falhar, nada e gravado.
$password = $null
if (-not $NoPassword) {
    $password = if ($PasswordSecure) { $PasswordSecure } else { Read-NewPassword }
    if ($password.Length -lt $script:KeyMinPasswordLength) { throw "A senha precisa ter pelo menos $script:KeyMinPasswordLength caracteres." }
}

$rsa = New-Object System.Security.Cryptography.RSACryptoServiceProvider(3072)
$rsa.PersistKeyInCsp = $false
try {
    $xml = $rsa.ToXmlString($true)
    if ($password) {
        [IO.File]::WriteAllBytes($full, (Protect-KeyXml $xml $password))
        # Confere de volta antes de dizer que gravou: um arquivo que nao abre e pior que nenhum.
        $back = Unprotect-KeyXml ([IO.File]::ReadAllBytes($full)) $password
        if ($back -ne $xml) { Remove-Item $full -Force; throw "Falha ao conferir o arquivo cifrado; nada foi mantido." }
        $xml = $null; $back = $null
    } else {
        [IO.File]::WriteAllText($full, $xml, (New-Object Text.UTF8Encoding($false)))
        Write-Warning "Chave privada em TEXTO PURO ($full). Quem copiar o arquivo publica atualizacoes. Prefira rodar sem -NoPassword."
    }
    # So o usuario atual le o arquivo.
    $acl = Get-Acl $full; $acl.SetAccessRuleProtection($true, $false)
    $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule([Security.Principal.WindowsIdentity]::GetCurrent().Name, "FullControl", "Allow")))
    Set-Acl $full $acl
    $how = if ($password) { "cifrada com senha" } else { "SEM senha" }
    Write-Host "Chave privada ($KeyId, $how) gravada em: $full  - guarde copia offline (guia). A SENHA nao fica em lugar nenhum: se perder, a chave e a cadeia de updates se perdem." -ForegroundColor Yellow
    Write-Host "Chave PUBLICA: cole em Services\UpdateKeys.cs, dentro de Trusted:"
    Write-Host ('    new TrustedKey("' + $KeyId + '", "' + $rsa.ToXmlString($false) + '"),')
} finally { $rsa.Dispose(); [GC]::Collect() }
