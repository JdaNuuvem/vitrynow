# Cadeia de build do print-client SEM depender de reconstruction/ (PC-04, R14).
#  - libs/ (HtmlAgilityPack, Newtonsoft.Json) versionadas aqui, conferidas por libs/SHA256SUMS.
#  - Compilador C# (Roslyn 4.8.0, pacote oficial Microsoft.Net.Compilers.Toolset) baixado do NuGet
#    para tools/roslyn (ignorado pelo git), com o SHA-256 do .nupkg fixado abaixo e a assinatura
#    Authenticode da Microsoft conferida no csc.exe.
# Uso: . "$PSScriptRoot\tools\toolchain.ps1"; $csc = Get-Csc [-RoslynDir <dir>]; Test-Libs
$script:PcRoot = Split-Path -Parent $PSScriptRoot
$script:RoslynVersion = "4.8.0"
$script:RoslynNupkgSha256 = "37333F4F1E2CE55E621355D6DA651DC23D4CB5F94A8F76B9478816E87F110AD9"
$script:RoslynUrl = "https://api.nuget.org/v3-flatcontainer/microsoft.net.compilers.toolset/$($script:RoslynVersion)/microsoft.net.compilers.toolset.$($script:RoslynVersion).nupkg"

function Test-Libs {
    $sums = Join-Path $script:PcRoot "libs\SHA256SUMS"
    if (-not (Test-Path $sums)) { throw "libs\SHA256SUMS ausente" }
    foreach ($line in Get-Content $sums) {
        if ($line -match '^\s*([0-9A-Fa-f]{64})\s+\*?(.+?)\s*$') {
            $f = Join-Path $script:PcRoot ("libs\" + $Matches[2])
            if (-not (Test-Path $f)) { throw "lib ausente: $f" }
            $h = (Get-FileHash $f -Algorithm SHA256).Hash
            if ($h -ne $Matches[1].ToUpper()) { throw "hash diferente em $($Matches[2]): esperado $($Matches[1]) obtido $h" }
        }
    }
}

function Get-Csc {
    param([string]$RoslynDir)
    if ($RoslynDir) {
        $c = Join-Path $RoslynDir "tasks\net472\csc.exe"
        if (-not (Test-Path $c)) { throw "csc.exe nao encontrado em $RoslynDir\tasks\net472" }
        return $c
    }
    $dir = Join-Path $script:PcRoot "tools\roslyn"
    $csc = Join-Path $dir "tasks\net472\csc.exe"
    if (-not (Test-Path $csc)) { Install-Roslyn $dir }
    $sig = Get-AuthenticodeSignature $csc
    if ($sig.Status -ne "Valid" -or $sig.SignerCertificate.Subject -notmatch "O=Microsoft Corporation") {
        throw "csc.exe sem assinatura valida da Microsoft ($($sig.Status)). Apague tools\roslyn e rode de novo."
    }
    return $csc
}

function Install-Roslyn([string]$dir) {
    Write-Host "Baixando Roslyn $($script:RoslynVersion) do NuGet para $dir ..."
    $tmp = Join-Path ([IO.Path]::GetTempPath()) ("pc_roslyn_" + [Guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Force $tmp | Out-Null
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        $pkg = Join-Path $tmp "roslyn.nupkg"
        Invoke-WebRequest -UseBasicParsing -Uri $script:RoslynUrl -OutFile $pkg -TimeoutSec 300
        $h = (Get-FileHash $pkg -Algorithm SHA256).Hash
        if ($h -ne $script:RoslynNupkgSha256) { throw "SHA-256 do pacote Roslyn nao confere (esperado $($script:RoslynNupkgSha256), obtido $h)" }
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $x = Join-Path $tmp "x"
        [IO.Compression.ZipFile]::ExtractToDirectory($pkg, $x)
        New-Item -ItemType Directory -Force (Join-Path $dir "tasks") | Out-Null
        Copy-Item (Join-Path $x "tasks\net472") (Join-Path $dir "tasks\net472") -Recurse -Force
    } finally { Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue }
}
