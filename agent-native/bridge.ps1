# Pont natif Windows pour HelpDesk EMUCI.
# Piloté par agent.mjs via stdin/stdout (protocole ligne par ligne).
# Entrée (stdin) :
#   CAP                -> capture l'écran, répond "FRAME <w> <h> <base64jpeg>"
#   M <x> <y>          -> déplace le curseur (pixels absolus)
#   D <left|right|middle> / U <...> / C <...>  -> bouton bas / haut / clic
#   S <dy>             -> molette (dy>0 = vers le bas)
#   K <ENTER|BACK|...> -> touche spéciale
#   T <base64utf8>     -> saisit du texte
# Sortie (stdout) : "SIZE <x> <y> <w> <h>" au démarrage, puis "FRAME ..." sur demande.
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing, System.Windows.Forms
$sig = @'
using System;
using System.Runtime.InteropServices;
public static class U32 {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint f, IntPtr e);
}
'@
Add-Type -TypeDefinition $sig

$MOUSE = @{ leftdown=0x0002; leftup=0x0004; rightdown=0x0008; rightup=0x0010; middledown=0x0020; middleup=0x0040; wheel=0x0800 }
$VK = @{ ENTER=0x0D; BACK=0x08; TAB=0x09; ESC=0x1B; DEL=0x2E; UP=0x26; DOWN=0x28; LEFT=0x25; RIGHT=0x27; HOME=0x24; END=0x23; PGUP=0x21; PGDN=0x22 }

$vs = [System.Windows.Forms.SystemInformation]::VirtualScreen
$out = [Console]::Out
$out.WriteLine("SIZE $($vs.X) $($vs.Y) $($vs.Width) $($vs.Height)")
$out.Flush()

# Encodeur JPEG réutilisé
$jpegCodec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$encParams = New-Object System.Drawing.Imaging.EncoderParameters 1
$encParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality, [long]45)
$targetW = 1100

function Capture {
  $bmp = New-Object System.Drawing.Bitmap $vs.Width, $vs.Height
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($vs.X, $vs.Y, 0, 0, $bmp.Size)
  $w = $targetW
  if ($vs.Width -lt $targetW) { $w = $vs.Width }
  $h = [int]($vs.Height * $w / $vs.Width)
  $small = New-Object System.Drawing.Bitmap $w, $h
  $g2 = [System.Drawing.Graphics]::FromImage($small)
  $g2.InterpolationMode = 'HighQualityBilinear'
  $g2.DrawImage($bmp, 0, 0, $w, $h)
  $ms = New-Object System.IO.MemoryStream
  $small.Save($ms, $jpegCodec, $encParams)
  $b64 = [Convert]::ToBase64String($ms.ToArray())
  $g.Dispose(); $g2.Dispose(); $bmp.Dispose(); $small.Dispose(); $ms.Dispose()
  $out.WriteLine("FRAME $w $h $b64")
  $out.Flush()
}

function SendKeysEscaped([string]$text) {
  $sb = New-Object System.Text.StringBuilder
  foreach ($ch in $text.ToCharArray()) {
    if ('+^%~(){}[]'.Contains($ch)) { [void]$sb.Append('{').Append($ch).Append('}') }
    else { [void]$sb.Append($ch) }
  }
  [System.Windows.Forms.SendKeys]::SendWait($sb.ToString())
}

while ($null -ne ($line = [Console]::In.ReadLine())) {
  if ($line.Length -eq 0) { continue }
  $sp = $line.IndexOf(' ')
  $cmd = if ($sp -lt 0) { $line } else { $line.Substring(0, $sp) }
  $arg = if ($sp -lt 0) { '' } else { $line.Substring($sp + 1) }
  try {
    switch ($cmd) {
      'CAP' { Capture }
      'M'   { $p = $arg.Split(' '); [U32]::SetCursorPos([int]$p[0], [int]$p[1]) | Out-Null }
      'D'   { [U32]::mouse_event($MOUSE["${arg}down"], 0, 0, 0, [IntPtr]::Zero) }
      'U'   { [U32]::mouse_event($MOUSE["${arg}up"], 0, 0, 0, [IntPtr]::Zero) }
      'C'   {
        [U32]::mouse_event($MOUSE["${arg}down"], 0, 0, 0, [IntPtr]::Zero)
        [U32]::mouse_event($MOUSE["${arg}up"], 0, 0, 0, [IntPtr]::Zero)
      }
      'S'   {
        $delta = if ([int]$arg -gt 0) { -120 } else { 120 }
        [U32]::mouse_event($MOUSE.wheel, 0, 0, [uint32]([int64]$delta -band 0xFFFFFFFF), [IntPtr]::Zero)
      }
      'K'   {
        if ($VK.ContainsKey($arg)) {
          $vk = [byte]$VK[$arg]
          [U32]::keybd_event($vk, 0, 0, [IntPtr]::Zero)
          [U32]::keybd_event($vk, 0, 2, [IntPtr]::Zero)
        }
      }
      'T'   {
        $txt = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($arg))
        SendKeysEscaped $txt
      }
    }
  } catch {
    [Console]::Error.WriteLine("bridge error: $_")
  }
}
