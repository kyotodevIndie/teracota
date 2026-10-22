. "$PSScriptRoot\common.ps1"
Add-Type -ReferencedAssemblies System.Drawing @"
using System; using System.Drawing; using System.Drawing.Imaging; using System.Runtime.InteropServices;
public static class C {
  // Conta pixels fora do retangulo que diferem da referencia (>12 soma de canais); dark/white = diferentes E quase pretos/brancos
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
      if (d > 12) { n++; if (pa[i]<10 && pa[i+1]<10 && pa[i+2]<10) dark++; if (pa[i]>245 && pa[i+1]>245 && pa[i+2]>245) white++; }
    }
    return n;
  }
  public static int Red(Bitmap a, int rx0, int ry0, int rx1, int ry1) {
    int n = 0;
    for (int y = ry0; y < ry1; y += 4) for (int x = rx0; x < rx1; x += 4) { var c = a.GetPixel(x,y); if (c.R>240 && c.G<20 && c.B<20) n++; }
    return n;
  }
}
public static class M {
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, UIntPtr e);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int hh, bool r);
}
"@
$log = "$PSScriptRoot\stage2.log"; Remove-Item $log -ErrorAction SilentlyContinue
function L($s) { $s | Tee-Object -FilePath $log -Append }
$p = Get-Process tauri-window-poc; $app = $p.Id
L "app_pid=$app"
$i = Parse-Info (Send-Cmd 'info'); $pt = Get-Points $i
L "pos=$($i.x),$($i.y) scale=$($i.sf)"

# T2 refeito com GA_ROOT
[void](Send-Cmd 'ignore 1'); [void][W]::SetCursorPos(900, 900); Start-Sleep -Milliseconds 200
L "T2 ignore=true pid_inside=$([W]::PidAt($pt.inX,$pt.inY)) pid_outside=$([W]::PidAt($pt.outX,$pt.outY)) app=$app"
[void](Send-Cmd 'ignore 0')
L "T2-control ignore=false pid_inside=$([W]::PidAt($pt.inX,$pt.inY)) pid_outside=$([W]::PidAt($pt.outX,$pt.outY)) app=$app"

# T3 modo emulado, em um monitor (funcao)
function Run-T3($label) {
  $i = Parse-Info (Send-Cmd 'info'); $pt = Get-Points $i
  [void](Send-Cmd 'emu 1'); [void][W]::SetCursorPos($pt.outX, $pt.outY); Start-Sleep -Milliseconds 300
  $a = [W]::PidAt($pt.inX, $pt.inY); $b = [W]::PidAt($pt.outX, $pt.outY)
  [void][W]::SetCursorPos($pt.inX, $pt.inY); Start-Sleep -Milliseconds 300
  $c = [W]::PidAt($pt.inX, $pt.inY)
  [void][W]::SetCursorPos($pt.outX, $pt.outY); Start-Sleep -Milliseconds 300
  $d = [W]::PidAt($pt.inX, $pt.inY)
  L "T3[$label] cursor_out: pid_at_inside=$a pid_at_outside=$b | cursor_in(300ms): pid_at_inside=$c | cursor_out again(300ms): pid_at_inside=$d | app=$app"
  $enter = @(); $leave = @()
  for ($k = 0; $k -lt 15; $k++) {
    [void][W]::SetCursorPos($pt.outX, $pt.outY); Start-Sleep -Milliseconds 250
    $sw = [Diagnostics.Stopwatch]::StartNew(); [void][W]::SetCursorPos($pt.inX, $pt.inY)
    while ([W]::PidAt($pt.inX, $pt.inY) -ne $app -and $sw.ElapsedMilliseconds -lt 2000) { Start-Sleep -Milliseconds 1 }
    $enter += $sw.ElapsedMilliseconds
    Start-Sleep -Milliseconds 250
    $sw.Restart(); [void][W]::SetCursorPos($pt.outX, $pt.outY)
    while ([W]::PidAt($pt.inX, $pt.inY) -eq $app -and $sw.ElapsedMilliseconds -lt 2000) { Start-Sleep -Milliseconds 1 }
    $leave += $sw.ElapsedMilliseconds
  }
  $e = $enter | Measure-Object -Average -Maximum -Minimum; $l = $leave | Measure-Object -Average -Maximum -Minimum
  L ("T3[$label] enter_ms(inside->PoC) avg={0:N1} min={1} max={2} | leave_ms avg={3:N1} min={4} max={5} | samples=15 (inclui granularidade ~1-15ms do Sleep) raw_enter=$($enter -join ',') raw_leave=$($leave -join ',')" -f $e.Average, $e.Minimum, $e.Maximum, $l.Average, $l.Minimum, $l.Maximum)
  [void](Send-Cmd 'emu 0')
}
Run-T3 'primario'

# T4: 200 alternancias em 20 s, cursor na borda esquerda do retangulo (emu desligado)
[void](Send-Cmd 'ignore 0')
$i = Parse-Info (Send-Cmd 'info'); $pt = Get-Points $i
$rx0 = [int](60 * $i.sf); $ry0 = [int](120 * $i.sf); $rx1 = [int](260 * $i.sf); $ry1 = [int](320 * $i.sf)
[void][W]::SetCursorPos($i.x + $rx0, $i.y + $ry0 + 100); Start-Sleep -Milliseconds 300
$ref = Get-Shot $i.x $i.y $i.w $i.h
$job = Start-Job { $c = New-Object Net.Sockets.TcpClient('127.0.0.1', 47600); $s = $c.GetStream(); $b = [Text.Encoding]::ASCII.GetBytes("toggle 200 20000`n"); $s.Write($b,0,$b.Length); (New-Object IO.StreamReader($s)).ReadToEnd() }
$frames = 0; $bad = 0; $badDark = 0; $badWhite = 0; $maxPix = 0
while ($job.State -eq 'Running') {
  $f = Get-Shot $i.x $i.y $i.w $i.h; $dk = 0; $wh = 0
  $n = [C]::Diff($f, $ref, $rx0, $ry0, $rx1, $ry1, [ref]$dk, [ref]$wh)
  $frames++; if ($n -gt 50) { $bad++; if ($n -gt $maxPix) { $maxPix = $n }; if ($dk -gt 50) { $badDark++ }; if ($wh -gt 50) { $badWhite++ }; if ($bad -eq 1) { $f.Save("$PSScriptRoot\t4_first_bad.png") } }
  $f.Dispose()
}
L ("T4 job_result: " + (Receive-Job $job -Wait))
$f = Get-Shot $i.x $i.y $i.w $i.h; $dk = 0; $wh = 0; $nfinal = [C]::Diff($f, $ref, $rx0, $ry0, $rx1, $ry1, [ref]$dk, [ref]$wh)
L "T4 frames=$frames frames_with_artifact(>50px differing outside rect)=$bad dark=$badDark white=$badWhite max_px=$maxPix final_frame_diff_px=$nfinal(dark=$dk white=$wh)"
L "T4 final red_in_rect_samples=$([C]::Red($f,$rx0,$ry0,$rx1,$ry1))/$((($rx1-$rx0)/4)*(($ry1-$ry0)/4))"
[void](Send-Cmd 'ignore 0')

# T7 arrasto
$LD = 2; $LU = 4
L "T7 start: pos=$($i.x),$($i.y)"
foreach ($mode in 0, 1) {
  [void](Send-Cmd "ignore $mode"); Start-Sleep -Milliseconds 200
  $i0 = Parse-Info (Send-Cmd 'info'); $pt0 = Get-Points $i0
  [void][W]::SetCursorPos($pt0.inX, $pt0.inY); Start-Sleep -Milliseconds 150
  [M]::mouse_event($LD, 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 100
  $job = Start-Job { $c = New-Object Net.Sockets.TcpClient('127.0.0.1', 47600); $c.ReceiveTimeout = 4000; $s = $c.GetStream(); $b = [Text.Encoding]::ASCII.GetBytes("drag`n"); $s.Write($b,0,$b.Length); try { (New-Object IO.StreamReader($s)).ReadToEnd() } catch { 'timeout' } }
  Start-Sleep -Milliseconds 200
  foreach ($d in 10, 30, 60, 100) { [void][W]::SetCursorPos($pt0.inX + $d, $pt0.inY + $d); Start-Sleep -Milliseconds 60 }
  [M]::mouse_event($LU, 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 300
  $r = Receive-Job $job -Wait -ErrorAction SilentlyContinue
  $i1 = Parse-Info (Send-Cmd 'info')
  L "T7 ignore=$mode start_dragging_result=[$r] pos_before=$($i0.x),$($i0.y) pos_after=$($i1.x),$($i1.y)"
  [void](Send-Cmd 'move 200 200')
}
# set_position programatico com ignore=true
[void](Send-Cmd 'ignore 1'); $m = Send-Cmd 'move 300 250'; L "T7 set_position ignore=true: $($m -replace "`n",' | ')"
[void](Send-Cmd 'move 200 200'); [void](Send-Cmd 'ignore 0')

# T8 multi-monitor: secundario em (-2560,-355) 2560x1440
$m = Send-Cmd 'move -2400 0'; L "T8 move to secondary: $($m -replace "`n",' | ')"
$i2 = Parse-Info (Send-Cmd 'info'); $pt2 = Get-Points $i2
$sh = Get-Shot $i2.x $i2.y $i2.w $i2.h
L "T8 secondary red_samples=$([C]::Red($sh,[int](60*$i2.sf),[int](120*$i2.sf),[int](260*$i2.sf),[int](320*$i2.sf)))/$((200/4)*(200/4)) win_pos=$($i2.x),$($i2.y) sf=$($i2.sf)"
[void](Send-Cmd 'ignore 1')
L "T8 secondary ignore=true pid_inside=$([W]::PidAt($pt2.inX,$pt2.inY)) pid_outside=$([W]::PidAt($pt2.outX,$pt2.outY)) app=$app"
[void](Send-Cmd 'ignore 0')
L "T8 secondary ignore=false pid_inside=$([W]::PidAt($pt2.inX,$pt2.inY)) pid_outside=$([W]::PidAt($pt2.outX,$pt2.outY)) app=$app"
Run-T3 'secundario'
$m = Send-Cmd 'move 1700 800'; L "T8 move near primary right edge: $($m -replace "`n",' | ')"
$m = Send-Cmd 'move -200 200'; L "T8 move straddling boundary (-200,200): $($m -replace "`n",' | ')"
[void](Send-Cmd 'move 200 200')
