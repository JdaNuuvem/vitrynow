# Gera o par de chaves de ASSINATURA DE RELEASE do auto-update (RSA 3072, SHA-256) — PC-04.
#   - A chave PRIVADA fica FORA do repositorio (-OutPrivate), com permissao so para voce.
#     Quem a tiver pode publicar atualizacoes que todo print-client instalado vai aceitar.
#   - A chave PUBLICA (XML) e impressa: cole em Services\UpdateKeys.cs (PublicKeyXml) e gere um novo build.
# Decisao de custodia (quem guarda, backup, rotacao) e do Claudio/Atlas — este script nao grava em nuvem.
param(
    [Parameter(Mandatory = $true)][string]$OutPrivate,
    [switch]$Force
)
$ErrorActionPreference = "Stop"
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
    Write-Host "Chave privada gravada em: $full" -ForegroundColor Yellow
    Write-Host "Chave PUBLICA (cole em Services\UpdateKeys.cs, PublicKeyXml):"
    Write-Host $rsa.ToXmlString($false)
} finally { $rsa.Dispose() }
