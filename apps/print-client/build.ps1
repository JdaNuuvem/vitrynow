# Build sem VS/dotnet SDK: MSBuild 4.0 do Framework + compilador Roslyn vendorizado em
# reconstruction/tools/roslyn (mesmo truque usado em reconstruction/build.ps1).
param(
    [string]$Configuration = "Release"
)
$msbuild = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\MSBuild.exe"
$csc = Join-Path $PSScriptRoot "..\..\..\reconstruction\tools\roslyn\tasks\net472\csc.exe"
$proj = Join-Path $PSScriptRoot "MeuCardapio.PrintClient.csproj"
& $msbuild $proj /t:Rebuild "/p:Configuration=$Configuration" "/p:CscToolExe=$csc" /v:m /nologo
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host ""
$outDir = Join-Path $PSScriptRoot "bin\$Configuration"
Get-ChildItem -Path $outDir -Filter '*.exe' | ForEach-Object {
    Write-Host ("OK -> " + $_.FullName) -ForegroundColor Green
}
