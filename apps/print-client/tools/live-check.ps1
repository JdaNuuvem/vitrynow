# Conferencia cruzada PC-03 x API-12 (SO DEV): roda o DeviceClient REAL (UsePrintJobs) contra uma API LOCAL, com impressora virtual.
# Compila o nucleo do print-client + tools\LiveCheck.cs e executa em memoria (Smart App Control). Nao toca producao.
# Passo a passo e resultados: docs\conferencia-cruzada-api12.md
# Uso: .\live-check.ps1 -Token mcd_... -OutDir <pasta> -Ledger <printed.json> -Seconds 20 [-Fault offline|nopaper]
param(
  [Parameter(Mandatory = $true)][string]$Token,
  [Parameter(Mandatory = $true)][string]$OutDir,
  [Parameter(Mandatory = $true)][string]$Ledger,
  [string]$BaseUrl = "http://127.0.0.1:3011",
  [int]$Seconds = 20,
  [string]$Fault = "",
  [string]$ClientDir = "",
  [string]$RoslynDir = ""
)
$ErrorActionPreference = "Stop"
if (-not $ClientDir) { $ClientDir = Split-Path -Parent $PSScriptRoot }
. (Join-Path $ClientDir "tools\toolchain.ps1")
$csc = Get-Csc -RoslynDir $RoslynDir
$json = Join-Path $ClientDir "libs\Newtonsoft.Json.dll"
$tmp = Join-Path $env:TEMP ("meucardapio_live_" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
$dll = Join-Path $tmp "Live.dll"
$srcs = @(
  "Models\PrintableOrder.cs", "Models\PrintJob.cs",
  "Printing\TicketDocument.cs", "Printing\TicketText.cs", "Printing\TicketBuilder.cs", "Printing\TextTicketWriter.cs", "Printing\IPrintTarget.cs",
  "Printing\GdiTicketPainter.cs", "Printing\VirtualPrintTarget.cs", "Printing\PrinterProbe.cs",
  "Services\PrintFailure.cs", "Services\PrintCoordinator.cs", "Services\DeviceClient.cs", "Services\PrintLedger.cs", "Services\SecretStore.cs",
  "Services\AppSettings.cs", "Services\ApiUrlPolicy.cs", "Services\Logger.cs"
) | ForEach-Object { Join-Path $ClientDir $_ }
$srcs += (Join-Path $PSScriptRoot "LiveCheck.cs")
$o = & $csc /nologo /target:library "/out:$dll" /r:mscorlib.dll /r:System.dll /r:System.Core.dll /r:System.Drawing.dll /r:System.Security.dll /r:System.Net.Http.dll /r:System.Management.dll "/r:$json" @srcs 2>&1 | Out-String
if ($LASTEXITCODE -ne 0) { Write-Error "csc falhou:`n$o"; exit 1 }
[Reflection.Assembly]::LoadFrom($json) | Out-Null
$a = [Reflection.Assembly]::Load([IO.File]::ReadAllBytes($dll))
$t = $a.GetType("MeuCardapio.PrintClient.LiveCheck")
$args2 = New-Object object[] 6
$args2[0] = $BaseUrl; $args2[1] = $Token; $args2[2] = $OutDir; $args2[3] = $Ledger; $args2[4] = $Seconds; $args2[5] = $Fault
$res = $t.GetMethod("Run").Invoke($null, $args2)
Write-Output $res
Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
