. "$PSScriptRoot\common.ps1"
Add-Type -ReferencedAssemblies System.Drawing @"
using System; using System.Drawing; using System.Drawing.Imaging; using System.Runtime.InteropServices;
public static class C {
  public static int Diff(Bitmap a, Bitmap b, int rx0, int ry0, int rx1, int ry1, out int dark, out int white) {
    int w = a.Width, h = a.Height; dark = 0; white = 0; int n = 0;
    var ra = a.LockBits(new Rectangle(0,0,w,h), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
    var rb = b.LockBits(new Rectangle(0,0,w,h), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
    byte[] pa = new byte[ra.Stride*h], pb = new byte[rb.Stride*h];
    Marshal.Copy(ra.Scan0, pa, 0, pa.Length); Marshal.Copy(rb.Scan0, pb, 0, pb.Length);
    a.UnlockBits(ra); b.UnlockBits(rb);
    for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) {
      if (x >= rx0 && x < rx1 && y >= ry0 && y < ry1) continue;
      int i = y*ra.Stride + x*4;
      int d = Math.Abs(pa[i]-pb[i]) + Math.Abs(pa[i+1]-pb[i+1]) + Math.Abs(pa[i+2]-pb[i+2]);
      if (d > 12) { n++; if (pa[i]<60 && pa[i+1]<60 && pa[i+2]<60) dark++; if (pa[i]>245 && pa[i+1]>245 && pa[i+2]>245) white++; }
    }
    return n;
  }
  public static int Red(Bitmap a, int rx0, int ry0, int rx1, int ry1) {
    int n = 0;
    for (int y = ry0; y < ry1; y += 4) for (int x = rx0; x < rx1; x += 4) { var c = a.GetPixel(x,y); if (c.R>240 && c.G<20 && c.B<20) n++; }
    return n;
  }
}
"@
$log = "$PSScriptRoot\stage4.log"; Remove-Item $log -ErrorAction SilentlyContinue
function L($s) { $s | Tee-Object -FilePath $log -Append }
$p = Start-Process $script:Exe -PassThru; $app = $p.Id
for ($k = 0; $k -lt 400; $k++) { try { [void](Send-Cmd 'get'); break } catch { Start-Sleep -Milliseconds 25 } }
Start-Sleep -Seconds 2
$i = Parse-Info (Send-Cmd 'info'); $pt = Get-Points $i
$rx0 = 60; $ry0 = 120; $rx1 = 260; $ry1 = 320
# T6: janela maximizada branca (processo proprio) aberta DEPOIS do PoC
$bd = Start-Process powershell -PassThru -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "$PSScriptRoot\backdrop.ps1"
Start-Sleep -Seconds 5
$sh = Get-Shot $i.x $i.y $i.w $i.h; $sh.Save("$PSScriptRoot\t6_shot.png")
L "T6 backdrop_pid=$($bd.Id) fg_pid=$([W]::FgPid()) pixel_outside_rect=$($sh.GetPixel(10,10)) red_samples_in_rect=$([C]::Red($sh,60,120,260,320))/2500 pid_at_inside=$([W]::PidAt($pt.inX,$pt.inY)) app=$app"
$ref = $sh
# T4 sobre fundo branco
[void](Send-Cmd 'ignore 0'); [void][W]::SetCursorPos($i.x + 60, $i.y + 220); Start-Sleep -Milliseconds 300
$job = Start-Job { $c = New-Object Net.Sockets.TcpClient('127.0.0.1', 47600); $s = $c.GetStream(); $b = [Text.Encoding]::ASCII.GetBytes("toggle 200 20000`n"); $s.Write($b,0,$b.Length); (New-Object IO.StreamReader($s)).ReadToEnd() }
$frames = 0; $bad = 0; $badDark = 0; $maxPix = 0
while ($job.State -eq 'Running') {
  $f = Get-Shot $i.x $i.y $i.w $i.h; $dk = 0; $wh = 0
  $n = [C]::Diff($f, $ref, $rx0, $ry0, $rx1, $ry1, [ref]$dk, [ref]$wh)
  $frames++; if ($n -gt 20) { $bad++; if ($n -gt $maxPix) { $maxPix = $n }; if ($dk -gt 20) { $badDark++ }; if ($bad -eq 1) { $f.Save("$PSScriptRoot\t4_white_first_bad.png") } }
  $f.Dispose()
}
L ("T4-white job_result: " + (Receive-Job $job -Wait))
L "T4-white frames=$frames frames_with_artifact(>20px differing outside rect)=$bad frames_with_dark_px=$badDark max_px=$maxPix"
# T4b: modo emulado ligado, cursor oscilando na borda por 10 s
[void](Send-Cmd 'emu 1'); $tog = 0; $sw = [Diagnostics.Stopwatch]::StartNew(); $frames = 0; $bad = 0; $badDark = 0; $maxPix = 0
while ($sw.ElapsedMilliseconds -lt 10000) {
  $dx = if ($tog % 2) { 58 } else { 63 }; [void][W]::SetCursorPos($i.x + $dx, $i.y + 220); $tog++
  $f = Get-Shot $i.x $i.y $i.w $i.h; $dk = 0; $wh = 0
  $n = [C]::Diff($f, $ref, $rx0, $ry0, $rx1, $ry1, [ref]$dk, [ref]$wh)
  $frames++; if ($n -gt 20) { $bad++; if ($n -gt $maxPix) { $maxPix = $n }; if ($dk -gt 20) { $badDark++ } }
  $f.Dispose(); Start-Sleep -Milliseconds 20
}
[void](Send-Cmd 'emu 0')
L "T4b-emu-edge-oscillation 10s frames=$frames frames_with_artifact=$bad frames_with_dark_px=$badDark max_px=$maxPix cursor_moves=$tog"
[void](Send-Cmd 'quit'); Start-Sleep -Milliseconds 500
Stop-Process -Id $bd.Id -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -match 'backdrop.ps1' } | ForEach-Object { Stop-Process -Id $_.ProcessId -ErrorAction SilentlyContinue }
L "app_alive_after_quit=$([bool](Get-Process -Id $app -ErrorAction SilentlyContinue))"
