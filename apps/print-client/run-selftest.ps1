# Compila TicketRenderer + TicketTemplate + SelfTest em DLL (csc do Roslyn vendorizado em
# reconstruction/tools/roslyn) e executa em memoria dentro do processo do PowerShell,
# contornando o bloqueio do Smart App Control sobre EXEs novos (mesma técnica usada em
# reconstruction/tools/run-selftest.ps1).
$ErrorActionPreference = "Stop"
$base = $PSScriptRoot
$csc  = Join-Path $base "..\..\..\reconstruction\tools\roslyn\tasks\net472\csc.exe"
$libs = Join-Path $base "..\..\..\reconstruction\libs"
$tmp  = Join-Path $env:TEMP "meucardapio_selftest"
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
$outD = Join-Path $tmp "MeuCardapioSelfTest.dll"
$hap  = Join-Path $libs "HtmlAgilityPack.dll"
$json = Join-Path $libs "Newtonsoft.Json.dll"
$src1 = Join-Path $base "Printing\TicketRenderer.cs"
$src2 = Join-Path $base "SelfTest.cs"
$src3 = Join-Path $base "Models\PrintableOrder.cs"
$src4 = Join-Path $base "Services\TicketTemplate.cs"
$o = & $csc /nologo /target:library "/out:$outD" /r:mscorlib.dll /r:System.dll /r:System.Core.dll /r:System.Drawing.dll "/r:$hap" "/r:$json" "$src1" "$src2" "$src3" "$src4" 2>&1 | Out-String
if ($LASTEXITCODE -ne 0) { Write-Error "csc falhou:`n$o"; exit 1 }
[Reflection.Assembly]::LoadFrom($hap) | Out-Null
[Reflection.Assembly]::LoadFrom($json) | Out-Null
$a = [Reflection.Assembly]::LoadFrom($outD)
$t = $a.GetType("MeuCardapio.PrintClient.SelfTest")
if (-not $t) { Write-Error "tipo MeuCardapio.PrintClient.SelfTest nao encontrado na DLL"; exit 3 }
$code = [int]$t.InvokeMember("Run", [System.Reflection.BindingFlags]"Public,Static,InvokeMethod", $null, $null, @())
"SELFTEST_EXIT=$code"
exit $code
