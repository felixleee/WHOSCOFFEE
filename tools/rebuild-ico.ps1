# icon.ico / favicon.ico 재생성 — 깨진 128 프레임 문제 해결
# 원본 ico 의 256x256 프레임을 뽑아 전 사이즈를 고품질로 다시 렌더 → 깔끔한 다중해상도 ico.
param([string]$Src = 'D:\WHOSCOFFEE\icon.ico', [string]$Out = 'D:\WHOSCOFFEE\icon.ico')
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

function Get-Frame256([string]$path) {
  $d = [IO.File]::ReadAllBytes($path)
  $n = [BitConverter]::ToUInt16($d, 4)
  $best = -1; $bestW = -1
  for ($i = 0; $i -lt $n; $i++) {
    $o = 6 + $i * 16; $w = $d[$o]; if ($w -eq 0) { $w = 256 }
    if ($w -ge $bestW) { $bestW = $w; $best = $i }
  }
  $o = 6 + $best * 16
  $sz = [BitConverter]::ToUInt32($d, $o + 8); $off = [BitConverter]::ToUInt32($d, $o + 12)
  $buf = New-Object byte[] $sz; [Array]::Copy($d, $off, $buf, 0, $sz)
  $ms = New-Object IO.MemoryStream (, $buf)
  return [System.Drawing.Bitmap]::FromStream($ms)
}

$srcBmp = Get-Frame256 $Src
Write-Host "  원본 프레임: $($srcBmp.Width)x$($srcBmp.Height)"

$sizes = 256, 128, 64, 48, 32, 16
$pngs = @()
foreach ($s in $sizes) {
  $bmp = New-Object System.Drawing.Bitmap $s, $s
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)
  $g.DrawImage($srcBmp, (New-Object System.Drawing.Rectangle 0, 0, $s, $s))
  $g.Dispose()
  $ms = New-Object IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $pngs += , $ms.ToArray()
  $bmp.Dispose()
  Write-Host ("    {0,3}px -> {1} B" -f $s, $pngs[-1].Length)
}
$srcBmp.Dispose()

# ICO 조립 (바이트 직접 작성 — little-endian)
$bytes = New-Object System.Collections.Generic.List[byte]
$u16 = { param($v) $bytes.AddRange([BitConverter]::GetBytes([uint16]$v)) }
$u32 = { param($v) $bytes.AddRange([BitConverter]::GetBytes([uint32]$v)) }
& $u16 0; & $u16 1; & $u16 $sizes.Count            # reserved, type=1(ico), count
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
  $s = $sizes[$i]; $len = $pngs[$i].Length
  $dim = if ($s -ge 256) { 0 } else { $s }
  $bytes.Add([byte]$dim); $bytes.Add([byte]$dim)   # width, height
  $bytes.Add([byte]0); $bytes.Add([byte]0)         # colors, reserved
  & $u16 1; & $u16 32                              # planes, bitcount
  & $u32 $len; & $u32 $offset                      # bytesinres, offset
  $offset += $len
}
foreach ($p in $pngs) { $bytes.AddRange($p) }
[IO.File]::WriteAllBytes($Out, $bytes.ToArray())
Write-Host "  완료: $Out ($($bytes.Count) B, $($sizes.Count) 프레임)" -ForegroundColor Green
