# Build sem VS/dotnet SDK e sem depender de reconstruction/ (PC-04):
# MSBuild 4.0 do .NET Framework + Roslyn fixado por hash (tools\toolchain.ps1) + libs\ versionadas.
# Reprodutivel: Deterministic + PathMap; o SHA-256 do EXE sai no fim (mesma fonte => mesmo hash).
param(
    [string]$Configuration = "Release",
    [string]$RoslynDir = ""
)
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "tools\toolchain.ps1")
Test-Libs
$csc = Get-Csc -RoslynDir $RoslynDir
$msbuild = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\MSBuild.exe"
$proj = Join-Path $PSScriptRoot "MeuCardapio.PrintClient.csproj"
# O Csc do MSBuild 4.0 nao conhece Deterministic/PathMap: passamos /deterministic e /pathmap por response file para que o caminho
# do disco (PDB) nao entre no EXE. Mesma fonte => mesmo SHA-256, em qualquer pasta.
$obj = Join-Path $PSScriptRoot "obj"
New-Item -ItemType Directory -Force $obj | Out-Null
$rsp = Join-Path $obj "pathmap.rsp"
Set-Content -Path $rsp -Value @('/deterministic', ('/pathmap:"' + $PSScriptRoot.TrimEnd('\') + '=C:\src\print-client"')) -Encoding ASCII
& $msbuild $proj /t:Rebuild "/p:Configuration=$Configuration" "/p:CscToolExe=$csc" "/p:CompilerResponseFile=$rsp" /v:m /nologo
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host ""
$outDir = Join-Path $PSScriptRoot "bin\$Configuration"
Get-ChildItem -Path $outDir -Filter '*.exe' | ForEach-Object {
    Write-Host ("OK -> " + $_.FullName) -ForegroundColor Green
    Write-Host ("SHA256 " + (Get-FileHash $_.FullName -Algorithm SHA256).Hash)
}
