Add-Type -AssemblyName System.Drawing
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class W {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L,T,R,B; }
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint f);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int i);
  public static uint PidAt(int x, int y) {
    POINT p; p.X = x; p.Y = y;
    IntPtr h = WindowFromPoint(p);
    if (h == IntPtr.Zero) return 0; h = GetAncestor(h, 2);
    uint pid; GetWindowThreadProcessId(h, out pid); return pid;
  }
  public static uint FgPid() { uint pid; GetWindowThreadProcessId(GetForegroundWindow(), out pid); return pid; }
}
"@
[void][W]::SetProcessDPIAware()
$script:Exe = 'K:\dev\waifu-claude-pocket\poc\tauri-window\target\release\tauri-window-poc.exe'

function Send-Cmd([string]$cmd) {
  $c = New-Object System.Net.Sockets.TcpClient('127.0.0.1', 47600)
  $s = $c.GetStream(); $b = [Text.Encoding]::ASCII.GetBytes($cmd + "`n"); $s.Write($b, 0, $b.Length)
  $c.ReceiveTimeout = 60000
  $r = New-Object IO.StreamReader($s); $out = $r.ReadToEnd(); $c.Close(); return $out
}
function Get-Shot([int]$x, [int]$y, [int]$w, [int]$h) {
  $bmp = New-Object System.Drawing.Bitmap $w, $h
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($x, $y, 0, 0, (New-Object System.Drawing.Size $w, $h))
  $g.Dispose(); return $bmp
}
function Parse-Info([string]$t) {
  $m = [regex]::Match($t, 'win_scale=([\d\.]+) outer_pos=PhysicalPosition \{ x: (-?\d+), y: (-?\d+) \} outer_size=PhysicalSize \{ width: (\d+), height: (\d+) \}')
  return @{ sf = [double]$m.Groups[1].Value; x = [int]$m.Groups[2].Value; y = [int]$m.Groups[3].Value; w = [int]$m.Groups[4].Value; h = [int]$m.Groups[5].Value }
}
# Pontos fisicos: dentro do retangulo (centro) e fora (canto superior-esquerdo da janela)
function Get-Points($i) {
  return @{ inX = [int]($i.x + 160 * $i.sf); inY = [int]($i.y + 220 * $i.sf); outX = [int]($i.x + 15 * $i.sf); outY = [int]($i.y + 15 * $i.sf) }
}
