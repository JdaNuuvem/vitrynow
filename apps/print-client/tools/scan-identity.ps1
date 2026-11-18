# Varredura de identidade do terceiro (R24, PC-09): procura no codigo, no EXE e no instalador qualquer rastro de
# nome, dominio ou modulo do cardapio.ai / do clone do reconstruction/. Sai com 1 se achar algo FORA da lista de
# excecoes (comentarios que dizem "nao e do cardapio.ai" sao aceitos).
#   .\tools\scan-identity.ps1                 (codigo + bin\Release + bin\Installer, se existirem)
param([string]$Root = "")
$ErrorActionPreference = "Stop"
if (-not $Root) { $Root = Split-Path -Parent $PSScriptRoot }
# Termos que NAO podem aparecer em binarios (EXE/DLL/instalador). "MeuCardapio" e o nome nosso e nao casa com estes.
$binaryTerms = @("cardapio.ai", "Cardapio.ai", "cardapioai", "CardapioAI", "CardapioClone", ("Impress" + [char]0xE3 + "o v10"))
# Textos (codigo/documentos): so aceita mencao negativa ("nao e do cardapio.ai").
$textTerms = @("cardapio\.ai", "cardapioai", "CardapioClone", "reconstruction[\\/]")
$problems = New-Object System.Collections.Generic.List[string]

function Search-Bytes($path, $term) {
    $bytes = [IO.File]::ReadAllBytes($path)
    foreach ($enc in @([Text.Encoding]::UTF8, [Text.Encoding]::Unicode)) {
        $needle = $enc.GetBytes($term)
        for ($i = 0; $i -le $bytes.Length - $needle.Length; $i++) {
            if ($bytes[$i] -ne $needle[0]) { continue }
            $ok = $true
            for ($j = 1; $j -lt $needle.Length; $j++) { if ($bytes[$i + $j] -ne $needle[$j]) { $ok = $false; break } }
            if ($ok) { return $true }
        }
    }
    return $false
}

# 1) binarios
$bins = @()
foreach ($d in @("bin\Release", "bin\Installer")) {
    $p = Join-Path $Root $d
    if (Test-Path $p) { $bins += Get-ChildItem $p -File | Where-Object { $_.Extension -in ".exe", ".dll" } }
}
foreach ($f in $bins) {
    if ($f.Name -eq "Newtonsoft.Json.dll") { continue }   # biblioteca de terceiros conhecida
    foreach ($t in $binaryTerms) {
        if (Search-Bytes $f.FullName $t) { $problems.Add("binario $($f.Name) contem '$t'") }
    }
    $vi = $f.VersionInfo
    foreach ($field in @($vi.CompanyName, $vi.ProductName, $vi.FileDescription, $vi.LegalCopyright)) {
        foreach ($t in $binaryTerms) { if ($field -and $field -like "*$t*") { $problems.Add("versao de $($f.Name) contem '$t'") } }
    }
}

# 2) codigo e documentos: so mencoes negativas
$negative = '(n.o|nada|sem|nunca|nosso|NOSSO|fora de escopo|decis.o|origem)'   # "." cobre o til de "nao"/"decisao" sem depender de acento no arquivo
$files = Get-ChildItem $Root -Recurse -File -Include *.cs, *.ps1, *.iss, *.csproj, *.md, *.json -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -notmatch '\\(bin|obj|tools\\roslyn|libs)\\' -and $_.Name -ne "scan-identity.ps1" }
foreach ($f in $files) {
    $n = 0
    foreach ($line in [IO.File]::ReadLines($f.FullName)) {
        $n++
        foreach ($t in $textTerms) {
            if ($line -match $t -and $line -notmatch $negative) { $problems.Add("$($f.FullName.Substring($Root.Length + 1)):$n  $($line.Trim())") }
        }
    }
}

if ($problems.Count -gt 0) {
    Write-Host "IDENTIDADE DO TERCEIRO ENCONTRADA:" -ForegroundColor Red
    $problems | ForEach-Object { Write-Host "  $_" }
    exit 1
}
Write-Host "scan-identity: nenhum rastro do terceiro em $($bins.Count) binario(s) e $($files.Count) arquivo(s) de texto." -ForegroundColor Green
