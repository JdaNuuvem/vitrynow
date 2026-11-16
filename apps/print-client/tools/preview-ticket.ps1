# Imprime tiquetes de exemplo na IMPRESSORA VIRTUAL (sem impressora fisica): grava .txt (colunas, igual aos golden
# files) e .png (o mesmo desenho do GDI+ da impressora real, a 203 dpi) em -OutDir, para 58 mm e 80 mm.
# Serve para conferir o layout na tela e para anexar em revisoes. Dados de exemplo FICTICIOS.
#   .\tools\preview-ticket.ps1 -OutDir $env:TEMP\previa-tiquetes
param(
    [Parameter(Mandatory = $true)][string]$OutDir,
    [string]$RoslynDir = ""
)
$ErrorActionPreference = "Stop"
$base = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot "toolchain.ps1")
Test-Libs
$csc = Get-Csc -RoslynDir $RoslynDir
$tmp = Join-Path ([IO.Path]::GetTempPath()) ("pc_preview_" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force $tmp | Out-Null
$glue = Join-Path $tmp "Glue.cs"
@'
using System.IO;
using MeuCardapio.PrintClient;
using MeuCardapio.PrintClient.Printing;
public static class Preview
{
    public static string Run(string dir)
    {
        int n = 0;
        foreach (var mm in new[] { 58, 80 })
        {
            var target = new VirtualPrintTarget(Path.Combine(dir, mm + "mm"), true);
            foreach (var o in new[] { SelfTestPrint.Basic(), SelfTestPrint.LongAndHostile(), SelfTestPrint.ManyItems() })
            { target.Print(TicketBuilder.Build(o, mm)); n++; }
        }
        return n + " tiquetes gravados em " + dir;
    }
}
'@ | Set-Content -Path $glue -Encoding UTF8
$srcs = @(
  "SelfTest.cs", "SelfTestPrint.cs", "SelfTestHarness.cs", "SelfTestFakeApi.cs", "SelfTestDevice.cs", "SelfTestUpdater.cs", "SelfTestDeviceClient.cs",
  "Models\PrintableOrder.cs",
  "Printing\TicketDocument.cs", "Printing\TicketText.cs", "Printing\TicketBuilder.cs", "Printing\TextTicketWriter.cs", "Printing\IPrintTarget.cs",
  "Printing\GdiTicketPainter.cs", "Printing\VirtualPrintTarget.cs", "Printing\PrinterProbe.cs",
  "Services\PrintCoordinator.cs", "Services\DeviceClient.cs", "Services\PrintLedger.cs", "Services\SecretStore.cs",
  "Services\AppSettings.cs", "Services\ApiUrlPolicy.cs",
  "Services\Updater.cs", "Services\UpdateTransport.cs", "Services\UpdateVerifier.cs", "Services\Logger.cs"
) | ForEach-Object { Join-Path $base $_ }
$dll = Join-Path $tmp "Preview.dll"
$json = Join-Path $base "libs\Newtonsoft.Json.dll"
$o = & $csc /nologo /target:library "/out:$dll" /r:mscorlib.dll /r:System.dll /r:System.Core.dll /r:System.Drawing.dll /r:System.Security.dll /r:System.Net.Http.dll /r:System.Management.dll "/r:$json" @srcs $glue 2>&1 | Out-String
if ($LASTEXITCODE -ne 0) { throw "csc falhou:`n$o" }
[Reflection.Assembly]::LoadFrom($json) | Out-Null
$asm = [Reflection.Assembly]::Load([IO.File]::ReadAllBytes($dll))
New-Item -ItemType Directory -Force $OutDir | Out-Null
$full = (Resolve-Path $OutDir).Path
$callArgs = New-Object object[] 1
$callArgs[0] = [string]$full
Write-Host ([string]$asm.GetType("Preview").GetMethod("Run").Invoke($null, $callArgs))
