# Compila o nucleo testavel do print-client + SelfTest em DLL (Roslyn fixado por hash, tools\toolchain.ps1)
# e executa em memoria dentro do processo do PowerShell, contornando o bloqueio do Smart App Control
# sobre EXEs novos. NAO depende de reconstruction/ (PC-04, R14): libs em libs\, compilador baixado
# para tools\roslyn na primeira execucao (ou -RoslynDir <pasta com tasks\net472\csc.exe>).
# Golden files do tiquete: tests\golden (PC_GOLDEN_DIR). Para regenerar depois de mudanca INTENCIONAL de layout:
#   $env:PC_UPDATE_GOLDEN = "1"; .\run-selftest.ps1   (e REVISE o diff no git antes de commitar)
# -ReconRoot e aceito so por compatibilidade com scripts antigos e e ignorado.
param([string]$RoslynDir = "", [string]$ReconRoot = "")
$ErrorActionPreference = "Stop"
$base = $PSScriptRoot
. (Join-Path $base "tools\toolchain.ps1")
if ($ReconRoot) { Write-Warning "-ReconRoot ignorado: o print-client nao depende mais de reconstruction/." }
Test-Libs
$csc  = Get-Csc -RoslynDir $RoslynDir
$libs = Join-Path $base "libs"
$env:PC_GOLDEN_DIR = Join-Path $base "tests\golden"
$tmp  = Join-Path $env:TEMP ("meucardapio_selftest_" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
$outD = Join-Path $tmp "MeuCardapioSelfTest.dll"
$json = Join-Path $libs "Newtonsoft.Json.dll"
$srcs = @(
  "SelfTest.cs", "SelfTestPrint.cs", "SelfTestHarness.cs", "SelfTestAudio.cs", "SelfTestInstall.cs", "SelfTestFakeApi.cs", "SelfTestDevice.cs", "SelfTestUpdater.cs", "SelfTestDeviceClient.cs",
  "Models\PrintableOrder.cs",
  "Printing\TicketDocument.cs", "Printing\TicketText.cs", "Printing\TicketBuilder.cs", "Printing\TextTicketWriter.cs", "Printing\IPrintTarget.cs",
  "Printing\GdiTicketPainter.cs", "Printing\VirtualPrintTarget.cs", "Printing\PrinterProbe.cs",
  "Services\PrintCoordinator.cs", "Services\SingleInstance.cs", "Services\AlertSounds.cs", "Services\AudioPlayer.cs", "Services\DeviceClient.cs", "Services\PrintLedger.cs", "Services\SecretStore.cs",
  "Services\AppSettings.cs", "Services\ApiUrlPolicy.cs",
  "Services\Updater.cs", "Services\UpdateState.cs", "Services\UpdateTransport.cs", "Services\UpdateVerifier.cs", "Services\Logger.cs"
) | ForEach-Object { Join-Path $base $_ }
$o = & $csc /nologo /target:library "/out:$outD" /r:mscorlib.dll /r:System.dll /r:System.Core.dll /r:System.Drawing.dll /r:System.Security.dll /r:System.Net.Http.dll /r:System.Management.dll "/r:$json" @srcs 2>&1 | Out-String
if ($LASTEXITCODE -ne 0) { Write-Error "csc falhou:`n$o"; exit 1 }
[Reflection.Assembly]::LoadFrom($json) | Out-Null
# Em memoria: o Smart App Control as vezes bloqueia a DLL recem-compilada quando carregada do disco.
$a = [Reflection.Assembly]::Load([IO.File]::ReadAllBytes($outD))
$t = $a.GetType("MeuCardapio.PrintClient.SelfTest")
if (-not $t) { Write-Error "tipo MeuCardapio.PrintClient.SelfTest nao encontrado na DLL"; exit 3 }
$code = [int]$t.InvokeMember("Run", [System.Reflection.BindingFlags]"Public,Static,InvokeMethod", $null, $null, @())
"SELFTEST_EXIT=$code"
Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
exit $code
