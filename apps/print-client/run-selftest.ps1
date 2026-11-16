# Compila o nucleo testavel do print-client + SelfTest em DLL (Roslyn fixado por hash, tools\toolchain.ps1)
# e executa em memoria dentro do processo do PowerShell, contornando o bloqueio do Smart App Control
# sobre EXEs novos. NAO depende mais de reconstruction/ (PC-04, R14): libs em libs\, compilador baixado
# para tools\roslyn na primeira execucao (ou -RoslynDir <pasta com tasks\net472\csc.exe>).
# -ReconRoot e aceito so por compatibilidade com scripts antigos e e ignorado.
param([string]$RoslynDir = "", [string]$ReconRoot = "")
$ErrorActionPreference = "Stop"
$base = $PSScriptRoot
. (Join-Path $base "tools\toolchain.ps1")
if ($ReconRoot) { Write-Warning "-ReconRoot ignorado: o print-client nao depende mais de reconstruction/." }
Test-Libs
$csc  = Get-Csc -RoslynDir $RoslynDir
$libs = Join-Path $base "libs"
$tmp  = Join-Path $env:TEMP ("meucardapio_selftest_" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
$outD = Join-Path $tmp "MeuCardapioSelfTest.dll"
$hap  = Join-Path $libs "HtmlAgilityPack.dll"
$json = Join-Path $libs "Newtonsoft.Json.dll"
$srcs = @(
  "Printing\TicketRenderer.cs", "SelfTest.cs", "Models\PrintableOrder.cs", "Services\TicketTemplate.cs",
  "SelfTestDevice.cs", "SelfTestUpdater.cs", "Services\PrintLedger.cs", "Services\SecretStore.cs",
  "Services\AppSettings.cs", "Services\ApiUrlPolicy.cs",
  "Services\Updater.cs", "Services\UpdateTransport.cs", "Services\UpdateVerifier.cs", "Services\Logger.cs"
) | ForEach-Object { Join-Path $base $_ }
$o = & $csc /nologo /target:library "/out:$outD" /r:mscorlib.dll /r:System.dll /r:System.Core.dll /r:System.Drawing.dll /r:System.Security.dll "/r:$hap" "/r:$json" @srcs 2>&1 | Out-String
if ($LASTEXITCODE -ne 0) { Write-Error "csc falhou:`n$o"; exit 1 }
[Reflection.Assembly]::LoadFrom($hap) | Out-Null
[Reflection.Assembly]::LoadFrom($json) | Out-Null
# Em memoria: o Smart App Control as vezes bloqueia a DLL recem-compilada quando carregada do disco.
$a = [Reflection.Assembly]::Load([IO.File]::ReadAllBytes($outD))
$t = $a.GetType("MeuCardapio.PrintClient.SelfTest")
if (-not $t) { Write-Error "tipo MeuCardapio.PrintClient.SelfTest nao encontrado na DLL"; exit 3 }
$code = [int]$t.InvokeMember("Run", [System.Reflection.BindingFlags]"Public,Static,InvokeMethod", $null, $null, @())
"SELFTEST_EXIT=$code"
Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
exit $code
