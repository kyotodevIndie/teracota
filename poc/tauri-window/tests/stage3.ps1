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
public static class M {
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, UIntPtr e);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int hh, bool r);
}
"@
$log = "$PSScriptRoot\stage3.log"; Remove-Item $log -ErrorAction SilentlyContinue
function L($s) { $s | Tee-Object -FilePath $log -Append }

# backdrop branco (processo proprio)
$bd = Start-Process powershell -PassThru -WindowStyle Hidden -ArgumentList '-NoProfile','-Command','Add-Type -AssemblyName System.Windows.Forms; $f=New-Object Windows.Forms.Form; $f.FormBorderStyle="None"; $f.StartPosition="Manual"; $f.Location=New-Object Drawing.Point(100,100); $f.Size=New-Object Drawing.Size(700,900); $f.BackColor=[Drawing.Color]::White; [Windows.Forms.Application]::Run($f)'
Start-Sleep -Seconds 4
$fgBefore = [W]::FgPid()
$t0 = Get-Date
$p = Start-Process $script:Exe -PassThru; $app = $p.Id
for ($k = 0; $k -lt 400; $k++) { try { [void](Send-Cmd 'get'); break } catch { Start-Sleep -Milliseconds 25 } }
L ("run2 app_pid=$app cold_start_to_control_ms=" + [int]((Get-Date) - $t0).TotalMilliseconds + " fg_before=$fgBefore fg_after=$([W]::FgPid())")
Start-Sleep -Seconds 2
$i = Parse-Info (Send-Cmd 'info'); $pt = Get-Points $i
$rx0 = 60; $ry0 = 120; $rx1 = 260; $ry1 = 320
$ref = Get-Shot $i.x $i.y $i.w $i.h; $ref.Save("$PSScriptRoot\t4_ref_white.png")
L "backdrop_check pixel(10,10)=$($ref.GetPixel(10,10)) pixel(300,430)=$($ref.GetPixel(300,430))"

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
[void](Send-Cmd 'ignore 0')

# T7 arrasto via data-tauri-drag-region (mousedown real sintetico)
foreach ($mode in 0, 1) {
  [void](Send-Cmd 'move 200 200'); [void](Send-Cmd "ignore $mode"); Start-Sleep -Milliseconds 300
  $i0 = Parse-Info (Send-Cmd 'info'); $pt0 = Get-Points $i0
  [void][W]::SetCursorPos($pt0.inX, $pt0.inY); Start-Sleep -Milliseconds 200
  [M]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 150
  foreach ($d in 5, 20, 40, 80, 120) { [void][W]::SetCursorPos($pt0.inX + $d, $pt0.inY + $d); Start-Sleep -Milliseconds 60 }
  [M]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 400
  $i1 = Parse-Info (Send-Cmd 'info')
  L "T7-region ignore=$mode pos_before=$($i0.x),$($i0.y) pos_after=$($i1.x),$($i1.y) cursor_delta=120,120"
}
[void](Send-Cmd 'move 200 200'); [void](Send-Cmd 'ignore 0')

# T6 always-on-top com Notepad maximizado
$i = Parse-Info (Send-Cmd 'info'); $pt = Get-Points $i
$before = @(Get-Process notepad -ErrorAction SilentlyContinue | ForEach-Object Id)
Start-Process notepad; Start-Sleep -Seconds 3
$np = @(Get-Process notepad -ErrorAction SilentlyContinue | Where-Object { $before -notcontains $_.Id })
L "T6 notepad new pids=$($np.Id -join ',') handles=$($np.MainWindowHandle -join ',')"
foreach ($n in $np) { if ($n.MainWindowHandle -ne 0) { [void][M]::MoveWindow($n.MainWindowHandle, 50, 50, 800, 600, $true); [void][M]::ShowWindow($n.MainWindowHandle, 3) } }
Start-Sleep -Seconds 2
$rc = New-Object W+RECT
foreach ($n in $np) { if ($n.MainWindowHandle -ne 0) { [void][W]::GetWindowRect($n.MainWindowHandle, [ref]$rc); L "T6 notepad rect L=$($rc.L) T=$($rc.T) R=$($rc.R) B=$($rc.B)" } }
$sh = Get-Shot $i.x $i.y $i.w $i.h; $sh.Save("$PSScriptRoot\t6_shot.png")
L "T6 red_samples_in_rect=$([C]::Red($sh,60,120,260,320))/2500 pid_at_inside=$([W]::PidAt($pt.inX,$pt.inY)) app=$app fg_pid=$([W]::FgPid())"
L "T6 after: get=$(Send-Cmd 'get')"
foreach ($n in $np) { Stop-Process -Id $n.Id -ErrorAction SilentlyContinue }

# limpeza: so processos iniciados por este script
[void](Send-Cmd 'quit'); Start-Sleep -Milliseconds 500
Stop-Process -Id $bd.Id -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -match 'Windows.Forms.Form' } | ForEach-Object { Stop-Process -Id $_.ProcessId -ErrorAction SilentlyContinue }
L "app_alive_after_quit=$([bool](Get-Process -Id $app -ErrorAction SilentlyContinue))"
