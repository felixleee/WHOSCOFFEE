# WHOSCOFFEE 앱 아이콘 재생성 — 원두 2알 로고를 여백 있게 정중앙 렌더 → 다중해상도 .ico
# 원본 아이콘은 원두가 캔버스 밖으로 잘려 있어서(오른쪽/아래) 로고 아트부터 다시 그림.
# 로고 좌표는 index.html .logo-mark(viewBox 128) 기준. 배경은 크림 라운드 사각.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$sm = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$iq = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$po = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$cream = [System.Drawing.ColorTranslator]::FromHtml('#f0e6d6')
$ink = [System.Drawing.ColorTranslator]::FromHtml('#1c1c1c')

function New-IconBitmap([int]$S) {
  $bmp = New-Object System.Drawing.Bitmap $S, $S
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = $sm; $g.InterpolationMode = $iq; $g.PixelOffsetMode = $po
  $g.Clear([System.Drawing.Color]::Transparent)
  $k = $S / 256.0   # 256 기준 스케일

  # 크림 라운드 사각 배경
  $r = 56.0 * $k; $d = $r * 2
  $gp = New-Object System.Drawing.Drawing2D.GraphicsPath
  $gp.AddArc(0, 0, $d, $d, 180, 90)
  $gp.AddArc($S - $d, 0, $d, $d, 270, 90)
  $gp.AddArc($S - $d, $S - $d, $d, $d, 0, 90)
  $gp.AddArc(0, $S - $d, $d, $d, 90, 90)
  $gp.CloseFigure()
  $g.FillPath((New-Object System.Drawing.SolidBrush $cream), $gp)

  # 로고 좌표계로 변환: translate(128,128) scale(2) translate(-66,-64) [모두 *k]
  $g.TranslateTransform(128 * $k, 128 * $k)
  $g.ScaleTransform(2 * $k, 2 * $k)
  $g.TranslateTransform(-66, -64)

  $inkBrush = New-Object System.Drawing.SolidBrush $ink
  $creamPen = New-Object System.Drawing.Pen $cream, 3.5
  $creamPen.StartCap = 'Round'; $creamPen.EndCap = 'Round'

  # 원두 2알: (중심x,중심y,rx,ry,각도, 주름 베지어 4점)
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

# 전 사이즈 PNG 생성
$sizes = 256, 128, 64, 48, 32, 16
$pngs = @()
foreach ($s in $sizes) {
  $bmp = New-IconBitmap $s
  $ms = New-Object IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $pngs += , $ms.ToArray(); $bmp.Dispose()
  Write-Host ("    {0,3}px -> {1} B" -f $s, $pngs[-1].Length)
}
# 미리보기용 256 저장
$sp = "$env:TEMP\wc-icon-preview.png"; [IO.File]::WriteAllBytes($sp, $pngs[0]); Write-Host "  미리보기: $sp"

# ICO 조립
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
  Write-Host "  완료: $out ($($bytes.Count) B)" -ForegroundColor Green
}
