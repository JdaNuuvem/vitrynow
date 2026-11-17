# Gera um par de chaves de ASSINATURA DE RELEASE do auto-update (RSA 3072, SHA-256) - PC-04/PC-11.
#   - A chave PRIVADA fica FORA do repositorio (-OutPrivate), com permissao so para o seu usuario.
#     Quem a tiver pode publicar atualizacoes que todo print-client instalado vai aceitar.
#   - A chave PUBLICA (XML) e impressa ja no formato de Services\UpdateKeys.cs; gere DUAS (k1 primaria e k2 reserva
#     offline), cole as duas na lista Trusted e gere um novo build. Quem gera, guarda e assina e o Claudio (CL-10);
#     nenhum agente guarda a privada. Veja nightingale\guia-chave-release.md.
param(
    [Parameter(Mandatory = $true)][string]$OutPrivate,
    [string]$KeyId = "k1",
    [switch]$Force
)
$ErrorActionPreference = "Stop"
if ($KeyId -notmatch '^[A-Za-z0-9_-]{1,32}$') { throw "KeyId invalido: $KeyId" }
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
$full = [IO.Path]::GetFullPath($OutPrivate)
if ($full.StartsWith($repo, [StringComparison]::OrdinalIgnoreCase)) { throw "A chave privada nao pode ficar dentro do repositorio ($repo). Escolha uma pasta fora dele." }
if ((Test-Path $full) -and -not $Force) { throw "$full ja existe (use -Force para sobrescrever; isso invalida as atualizacoes assinadas com a chave antiga)." }
$rsa = New-Object System.Security.Cryptography.RSACryptoServiceProvider(3072)
$rsa.PersistKeyInCsp = $false
try {
    [IO.File]::WriteAllText($full, $rsa.ToXmlString($true), (New-Object Text.UTF8Encoding($false)))
    # So o usuario atual le o arquivo.
    $acl = Get-Acl $full; $acl.SetAccessRuleProtection($true, $false)
    $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule([Security.Principal.WindowsIdentity]::GetCurrent().Name, "FullControl", "Allow")))
    Set-Acl $full $acl
    Write-Host "Chave privada ($KeyId) gravada em: $full  - proteja com senha e guarde copia offline (guia)." -ForegroundColor Yellow
    Write-Host "Chave PUBLICA: cole em Services\UpdateKeys.cs, dentro de Trusted:"
    Write-Host ('    new TrustedKey("' + $KeyId + '", "' + $rsa.ToXmlString($false) + '"),')
} finally { $rsa.Dispose() }
