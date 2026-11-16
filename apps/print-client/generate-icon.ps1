# Gera um ícone PRÓPRIO (placeholder, não extraído do binário original) para o print-client.
# Usa só System.Drawing dentro do processo do powershell.exe (não cria/roda um EXE novo),
# mesma técnica de contorno do Smart App Control usada em run-selftest.ps1.
Add-Type -AssemblyName System.Drawing

function New-IconFrame([int]$size) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::Transparent)

    $bg = [System.Drawing.Color]::FromArgb(255, 0x16, 0xa3, 0x4a) # verde placeholder — troque pela cor da marca
    $brush = New-Object System.Drawing.SolidBrush $bg
    $margin = [Math]::Max(1, [int]($size * 0.06))
    $rectSize = $size - 2 * $margin
    $radius = [int]($rectSize * 0.28)

    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $radius * 2
    $path.AddArc($margin, $margin, $d, $d, 180, 90)
    $path.AddArc($margin + $rectSize - $d, $margin, $d, $d, 270, 90)
    $path.AddArc($margin + $rectSize - $d, $margin + $rectSize - $d, $d, $d, 0, 90)
    $path.AddArc($margin, $margin + $rectSize - $d, $d, $d, 90, 90)
    $path.CloseFigure()
    $g.FillPath($brush, $path)

    $fontSize = [Math]::Max(6, [int]($size * 0.52))
    $font = New-Object System.Drawing.Font "Segoe UI", $fontSize, ([System.Drawing.FontStyle]::Bold)
    $textBrush = [System.Drawing.Brushes]::White
    $format = New-Object System.Drawing.StringFormat
    $format.Alignment = [System.Drawing.StringAlignment]::Center
    $format.LineAlignment = [System.Drawing.StringAlignment]::Center
    $g.DrawString("M", $font, $textBrush, (New-Object System.Drawing.RectangleF 0, 0, $size, $size), $format)

    $g.Dispose()
    return $bmp
}

$outDir = Join-Path $PSScriptRoot "Resources"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$outPath = Join-Path $outDir "icon.ico"

# .ico multi-resolução manual: cada frame como PNG embutido (formato ICO moderno aceito pelo Windows).
$sizes = 16, 32, 48, 256
$pngBytesList = @()
foreach ($s in $sizes) {
    $bmp = New-IconFrame $s
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $pngBytesList += ,(@{ Size = $s; Bytes = $ms.ToArray() })
    $bmp.Dispose()
}

$fs = New-Object System.IO.FileStream $outPath, ([System.IO.FileMode]::Create)
$bw = New-Object System.IO.BinaryWriter $fs

# ICONDIR
$bw.Write([UInt16]0)        # reserved
$bw.Write([UInt16]1)        # type = icon
$bw.Write([UInt16]$pngBytesList.Count)

$headerSize = 6 + 16 * $pngBytesList.Count
$offset = $headerSize
foreach ($entry in $pngBytesList) {
    $s = $entry.Size
    $bw.Write([byte]($(if ($s -ge 256) { 0 } else { $s })))
    $bw.Write([byte]($(if ($s -ge 256) { 0 } else { $s })))
    $bw.Write([byte]0)      # color palette
    $bw.Write([byte]0)      # reserved
    $bw.Write([UInt16]1)    # color planes
    $bw.Write([UInt16]32)   # bits per pixel
    $bw.Write([UInt32]$entry.Bytes.Length)
    $bw.Write([UInt32]$offset)
    $offset += $entry.Bytes.Length
}
foreach ($entry in $pngBytesList) {
    $bw.Write($entry.Bytes)
}
$bw.Flush()
$bw.Close()
$fs.Close()

Write-Host "OK -> $outPath" -ForegroundColor Green
