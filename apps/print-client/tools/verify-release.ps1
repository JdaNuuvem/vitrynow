# Confere um release ANTES de subir para o servidor (PC-11): roda o MESMO codigo de decisao do app
# (Updater.Evaluate: keyId, assinatura, validade, anti-downgrade, hash, tamanho, nome do arquivo) sobre a pasta
# gerada por sign-update.ps1. Sai com 0 so se o app aceitaria o release.
#   .\tools\verify-release.ps1 -ReleaseDir .\bin\release-1.1.0 -Key k1=C:\Cofre\k1.pub.xml -Key k2=C:\Cofre\k2.pub.xml
#   (sem -Key usa as chaves embutidas em Services\UpdateKeys.cs)
param(
    [Parameter(Mandatory = $true)][string]$ReleaseDir,
    [string[]]$Key = @(),                       # "keyId=arquivo-com-a-chave-publica-xml"
    [string]$CurrentVersion = "0.0.1",          # versao instalada a simular (padrao: qualquer release e "novo")
    [string]$RoslynDir = ""
)
$ErrorActionPreference = "Stop"
$base = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot "toolchain.ps1")
Test-Libs
$csc = Get-Csc -RoslynDir $RoslynDir
$tmp = Join-Path ([IO.Path]::GetTempPath()) ("pc_verify_" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force $tmp | Out-Null
$glue = Join-Path $tmp "Glue.cs"
@'
using System;
using System.IO;
using System.Linq;
using MeuCardapio.PrintClient.Services;
public sealed class DirTransport : IUpdateTransport
{
    readonly string _dir; public DirTransport(string dir) { _dir = dir; }
    string Map(Uri u) { var p = Path.Combine(_dir, Path.GetFileName(u.AbsolutePath)); if (!File.Exists(p)) throw new UpdateException("arquivo ausente: " + Path.GetFileName(p)); return p; }
    public byte[] GetSmall(Uri url, int maxBytes) { var b = File.ReadAllBytes(Map(url)); if (b.Length > maxBytes) throw new UpdateException("maior que o limite"); return b; }
    public void Download(Uri url, string dest, long maxBytes) { File.Copy(Map(url), dest, true); }
}
public static class Verify
{
    public static string Run(string dir, string[] ids, string[] xmls, string current, string work)
    {
        var keys = ids.Select((id, i) => new TrustedKey(id, xmls[i])).ToList();
        if (keys.Count == 0) keys = UpdateKeys.Trusted.ToList();
        var r = Updater.Evaluate("https://release.invalido/up", current, keys, new DirTransport(dir), work, null, null);
        return r.Outcome + "|" + r.Version + "|" + r.Message + "|" + r.Required;
    }
}
'@ | Set-Content -Path $glue -Encoding UTF8
$srcs = @("Services\UpdateVerifier.cs", "Services\UpdateState.cs", "Services\Updater.cs", "Services\UpdateTransport.cs",
          "Services\AppSettings.cs", "Services\SecretStore.cs", "Services\ApiUrlPolicy.cs", "Services\Logger.cs") | ForEach-Object { Join-Path $base $_ }
$dll = Join-Path $tmp "Verify.dll"
$json = Join-Path $base "libs\Newtonsoft.Json.dll"
$o = & $csc /nologo /target:library "/out:$dll" /r:mscorlib.dll /r:System.dll /r:System.Core.dll /r:System.Security.dll /r:System.Net.Http.dll "/r:$json" @srcs $glue 2>&1 | Out-String
if ($LASTEXITCODE -ne 0) { throw "csc falhou:`n$o" }
[Reflection.Assembly]::LoadFrom($json) | Out-Null
# Carrega da memoria: evita o bloqueio de DLL nova por politica de aplicativo (Smart App Control).
$asm = [Reflection.Assembly]::Load([IO.File]::ReadAllBytes($dll))
$ids = @(); $xmls = @()
foreach ($k in $Key) {
    $id, $path = $k -split '=', 2
    $ids += $id; $xmls += [IO.File]::ReadAllText($path)
}
$work = Join-Path $tmp "work"
$callArgs = New-Object object[] 5
$callArgs[0] = [string](Resolve-Path $ReleaseDir).Path
$callArgs[1] = [string[]]$ids
$callArgs[2] = [string[]]$xmls
$callArgs[3] = [string]$CurrentVersion
$callArgs[4] = [string]$work
$res = [string]$asm.GetType("Verify").GetMethod("Run").Invoke($null, $callArgs)
$outcome, $ver, $msg, $required = $res -split '\|', 4
Write-Host "Resultado: $outcome  versao=$ver  obrigatoria=$required"
Write-Host $msg
$code = if ($outcome -eq "Ready") { 0 } else { 1 }
exit $code
