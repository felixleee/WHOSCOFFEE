# WHOSCOFFEE 아이콘 일괄 재생성 — 원두 2알 로고(브랜드색) on 크림.
#  PWA/애플: 전체 크림 사각(마스커블 안전, 런처가 둥글게 마스킹) → public/icon-512·192·apple-touch
#  favicon: 라운드 사각(투명 모서리) 멀티해상도 .ico → public/favicon.ico + icon.ico
#  로고 좌표는 index.html .logo-mark(viewBox 128) 기준.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$sm = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$iq = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$po = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$cream = [System.Drawing.ColorTranslator]::FromHtml('#f0e6d6')
$ink = [System.Drawing.ColorTranslator]::FromHtml('#3a2618')   # 브랜드(진한 원두 브라운)

function New-IconBitmap([int]$S, [bool]$Rounded) {
  $bmp = New-Object System.Drawing.Bitmap $S, $S
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = $sm; $g.InterpolationMode = $iq; $g.PixelOffsetMode = $po
  $g.Clear([System.Drawing.Color]::Transparent)
  $k = $S / 256.0
  if ($Rounded) {
    $r = 56.0 * $k; $d = $r * 2
    $gp = New-Object System.Drawing.Drawing2D.GraphicsPath
    $gp.AddArc(0, 0, $d, $d, 180, 90)
    $gp.AddArc($S - $d, 0, $d, $d, 270, 90)
    $gp.AddArc($S - $d, $S - $d, $d, $d, 0, 90)
    $gp.AddArc(0, $S - $d, $d, $d, 90, 90)
    $gp.CloseFigure()
    $g.FillPath((New-Object System.Drawing.SolidBrush $cream), $gp)
  }
  else {
    $g.Clear($cream)   # 전체 크림 사각
  }
  $g.TranslateTransform(128 * $k, 128 * $k)
  $g.ScaleTransform(2 * $k, 2 * $k)
  $g.TranslateTransform(-66, -64)
  $inkBrush = New-Object System.Drawing.SolidBrush $ink
  $creamPen = New-Object System.Drawing.Pen $cream, 3.5
  $creamPen.StartCap = 'Round'; $creamPen.EndCap = 'Round'
  $beans = @(
    @{ cx = 50; cy = 48; rx = 14; ry = 19; ang = -28; bz = @([System.Drawing.PointF]::new(50, 32), [System.Drawing.PointF]::new(46, 41), [System.Drawing.PointF]::new(54, 55), [System.Drawing.PointF]::new(50, 64)) },
    @{ cx = 78; cy = 80; rx = 14; ry = 19; ang = -28; bz = @([System.Drawing.PointF]::new(78, 64), [System.Drawing.PointF]::new(74, 73), [System.Drawing.PointF]::new(82, 87), [System.Drawing.PointF]::new(78, 96)) }
  )
  foreach ($b in $beans) {
    $st = $g.Save()
    $g.TranslateTransform([single]$b.cx, [single]$b.cy)
    $g.RotateTransform([single]$b.ang)
    $g.TranslateTransform([single](-$b.cx), [single](-$b.cy))
    $g.FillEllipse($inkBrush, $b.cx - $b.rx, $b.cy - $b.ry, $b.rx * 2, $b.ry * 2)
    $g.DrawBeziers($creamPen, [System.Drawing.PointF[]]$b.bz)
    $g.Restore($st)
  }
  $g.Dispose()
  return $bmp
}

function Save-Png([int]$S, [bool]$Rounded, [string]$Path) {
  $b = New-IconBitmap $S $Rounded
  $b.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  $b.Dispose()
  Write-Host ("  {0,-38} {1}px" -f $Path, $S) -ForegroundColor Green
}

# --- PWA/애플 PNG (전체 크림 사각) ---
Save-Png 512 $false 'D:\WHOSCOFFEE\public\icon-512.png'
Save-Png 192 $false 'D:\WHOSCOFFEE\public\icon-192.png'
Save-Png 180 $false 'D:\WHOSCOFFEE\public\apple-touch-icon.png'

# --- favicon.ico (라운드, 멀티 해상도) ---
$sizes = 256, 128, 64, 48, 32, 16
$pngs = @()
foreach ($s in $sizes) {
  $bmp = New-IconBitmap $s $true
  $ms = New-Object IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $pngs += , $ms.ToArray(); $bmp.Dispose()
}
$bytes = New-Object System.Collections.Generic.List[byte]
$u16 = { param($v) $bytes.AddRange([BitConverter]::GetBytes([uint16]$v)) }
$u32 = { param($v) $bytes.AddRange([BitConverter]::GetBytes([uint32]$v)) }
& $u16 0; & $u16 1; & $u16 $sizes.Count
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
  $s = $sizes[$i]; $len = $pngs[$i].Length; $dim = if ($s -ge 256) { 0 } else { $s }
  $bytes.Add([byte]$dim); $bytes.Add([byte]$dim); $bytes.Add([byte]0); $bytes.Add([byte]0)
  & $u16 1; & $u16 32; & $u32 $len; & $u32 $offset; $offset += $len
}
foreach ($p in $pngs) { $bytes.AddRange($p) }
foreach ($out in @('D:\WHOSCOFFEE\icon.ico', 'D:\WHOSCOFFEE\public\favicon.ico')) {
  [IO.File]::WriteAllBytes($out, $bytes.ToArray())
  Write-Host ("  {0,-38} multi" -f $out) -ForegroundColor Green
}
Write-Host '아이콘 재생성 완료 (#3a2618)' -ForegroundColor Cyan
