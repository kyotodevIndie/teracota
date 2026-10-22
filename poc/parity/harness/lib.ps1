# Biblioteca do harness de paridade Electron x Tauri (Windows, PowerShell 5+).
$ErrorActionPreference = 'Stop'
$script:Root   = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)   # ...\poc\parity -> ...\poc -> repo? ajustado abaixo
$script:Parity = Split-Path -Parent $PSScriptRoot                         # ...\poc\parity
$script:Repo   = Split-Path -Parent (Split-Path -Parent $script:Parity)   # raiz do repo pocket
$script:RawDir = Join-Path $script:Repo 'docs\phase0\parity\raw'
$script:RunDir = Join-Path $script:Parity '.runtime'
$script:ElectronExe = 'K:\dev\waifu-claude\node_modules\electron\dist\electron.exe'   # somente leitura (binario existente)
$script:TauriExe    = Join-Path $script:Parity 'tauri\target\release\tera-parity-tauri.exe'
$script:ElectronApp = Join-Path $script:Parity 'electron'
$script:Port = 47600
New-Item -ItemType Directory -Force $script:RawDir, $script:RunDir | Out-Null

Add-Type -TypeDefinition @"
using System; using System.Collections.Generic; using System.Diagnostics; using System.Runtime.InteropServices; using System.Threading;
public static class P {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L,T,R,B; }
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h, uint f);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll")] static extern void mouse_event(uint f, uint dx, uint dy, uint d, UIntPtr e);
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr c);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h, System.Text.StringBuilder s, int n);
  public static void InitDpi() { SetProcessDpiAwarenessContext(new IntPtr(-4)); }
  public static uint PidOf(IntPtr h) { uint pid; GetWindowThreadProcessId(h, out pid); return pid; }
  public static string Title(IntPtr h) { var sb = new System.Text.StringBuilder(256); GetWindowText(h, sb, 256); return sb.ToString(); }
  // pid da janela raiz sob o ponto (GA_ROOT); 0 se nenhuma
  public static uint RootPidAt(int x, int y) {
    POINT p; p.X = x; p.Y = y; IntPtr h = WindowFromPoint(p); if (h == IntPtr.Zero) return 0;
    IntPtr r = GetAncestor(h, 2); if (r == IntPtr.Zero) r = h; return PidOf(r);
  }
  public static bool IsHost(HashSet<uint> pids, int x, int y) { return pids.Contains(RootPidAt(x, y)); }
  public static HashSet<uint> Set(int[] a) { var s = new HashSet<uint>(); foreach (var i in a) s.Add((uint)i); return s; }
  // janelas visiveis de nivel superior dos pids: "hwnd,l,t,r,b,exstyle"
  public static string[] Windows(int[] pids) {
    var set = Set(pids); var res = new List<string>();
    EnumWindows((h, l) => { if (IsWindowVisible(h) && set.Contains(PidOf(h))) { RECT r; GetWindowRect(h, out r);
      if (r.R - r.L > 0 && r.B - r.T > 0) res.Add(h.ToInt64() + "," + r.L + "," + r.T + "," + r.R + "," + r.B + "," + GetWindowLong(h, -20)); } return true; }, IntPtr.Zero);
    return res.ToArray();
  }
  public static int[] Cursor() { POINT p; GetCursorPos(out p); return new int[] { p.X, p.Y }; }
  // Ciclos de hover: out -> in (latencia ate a janela passar a receber o cursor) e in -> out.
  // retorna pares [enter_ms, exit_ms]; -1 = timeout (800 ms)
  public static double[] HoverCycles(int[] pids, int inX, int inY, int outX, int outY, int cycles, int seed) {
    var set = Set(pids); var rnd = new Random(seed); var res = new double[cycles * 2]; var sw = new Stopwatch();
    for (int c = 0; c < cycles; c++) {
      SetCursorPos(outX, outY); Thread.Sleep(350 + rnd.Next(0, 40));
      sw.Restart(); SetCursorPos(inX, inY); double t = -1;
      while (sw.Elapsed.TotalMilliseconds < 800) { if (set.Contains(RootPidAt(inX, inY))) { t = sw.Elapsed.TotalMilliseconds; break; } }
      res[c * 2] = t; Thread.Sleep(250 + rnd.Next(0, 40));
      sw.Restart(); SetCursorPos(outX, outY); t = -1;
      while (sw.Elapsed.TotalMilliseconds < 800) { if (!set.Contains(RootPidAt(outX, outY))) { t = sw.Elapsed.TotalMilliseconds; break; } }
      res[c * 2 + 1] = t; Thread.Sleep(100);
    }
    return res;
  }
  // arrasto fisico simulado
  public static void Drag(int x, int y, int dx, int dy, int steps, int stepMs) {
    SetCursorPos(x, y); Thread.Sleep(200);
    mouse_event(0x0002, 0, 0, 0, UIntPtr.Zero); Thread.Sleep(60);
    for (int i = 1; i <= steps; i++) { SetCursorPos(x + dx * i / steps, y + dy * i / steps); Thread.Sleep(stepMs); }
    Thread.Sleep(60); mouse_event(0x0004, 0, 0, 0, UIntPtr.Zero);
  }
  // movimento circular continuo do cursor (CPU "arrasto simulado"), ate durMs
  public static void Wiggle(int cx, int cy, int rx, int ry, int durMs, int stepMs) {
    var sw = Stopwatch.StartNew(); double a = 0;
    while (sw.ElapsedMilliseconds < durMs) { SetCursorPos(cx + (int)(rx * Math.Cos(a)), cy + (int)(ry * Math.Sin(a))); a += 0.12; Thread.Sleep(stepMs); }
  }
}
"@
[P]::InitDpi()

function Send-Cmd([string]$cmd, [int]$timeoutMs = 15000) {
  $c = New-Object System.Net.Sockets.TcpClient
  $c.Connect('127.0.0.1', $script:Port)
  $s = $c.GetStream(); $b = [Text.Encoding]::ASCII.GetBytes($cmd + "`n"); $s.Write($b, 0, $b.Length)
  $s.ReadTimeout = $timeoutMs
  $r = New-Object IO.StreamReader($s); $out = $r.ReadToEnd(); $c.Close()
  return $out | ConvertFrom-Json
}

# Arvore de processos (pid raiz + descendentes)
function Get-Tree([int]$rootPid) {
  $all = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId
  $set = New-Object 'System.Collections.Generic.HashSet[int]'; [void]$set.Add($rootPid)
  do { $n = $set.Count
    foreach ($p in $all) { if ($set.Contains([int]$p.ParentProcessId)) { [void]$set.Add([int]$p.ProcessId) } }
  } while ($set.Count -ne $n)
  return [int[]]@($set)
}

# Inicia o host; $profile = pasta de perfil (userData / WebView2). Retorna o objeto Process.
function Start-Host([string]$hostName, [string[]]$hostArgs = @(), [string]$profile) {
  $psi = New-Object Diagnostics.ProcessStartInfo
  $psi.UseShellExecute = $false
  New-Item -ItemType Directory -Force $profile | Out-Null
  if ($hostName -eq 'electron') {
    $psi.FileName = $script:ElectronExe
    $psi.Arguments = ('"{0}" --user-data-dir="{1}" {2}' -f $script:ElectronApp, $profile, ($hostArgs -join ' '))
  } else {
    $psi.FileName = $script:TauriExe
    $psi.Arguments = ($hostArgs -join ' ')
    $psi.EnvironmentVariables['WEBVIEW2_USER_DATA_FOLDER'] = $profile
  }
  return [Diagnostics.Process]::Start($psi)
}

function Wait-Ready([int]$timeoutSec = 30) {
  $sw = [Diagnostics.Stopwatch]::StartNew()
  while ($sw.Elapsed.TotalSeconds -lt $timeoutSec) {
    try { $i = Send-Cmd 'info' 3000; if ($i.masksReady -and $i.firstPaintEpochMs) { return $i } } catch {}
    Start-Sleep -Milliseconds 100
  }
  throw 'host nao ficou pronto'
}

function Stop-Host($proc) {
  try { Send-Cmd 'quit' 3000 | Out-Null } catch {}
  if (-not $proc.WaitForExit(6000)) { Stop-Process -Id $proc.Id -Force }   # somente o PID proprio
  # espera os filhos (msedgewebview2) do proprio host sumirem
  Start-Sleep -Milliseconds 1500
}

function Epoch([datetime]$d) { return [DateTimeOffset]::new($d).ToUnixTimeMilliseconds() }

function Stats($vals) {
  $v = @($vals | Where-Object { $_ -ne $null -and $_ -ge 0 } | Sort-Object)
  if ($v.Count -eq 0) { return @{ n = 0 } }
  function Pc($p) { $k = ($v.Count - 1) * $p; $f = [math]::Floor($k); $c = [math]::Ceiling($k); return $v[$f] + ($v[$c] - $v[$f]) * ($k - $f) }
  $m = ($v | Measure-Object -Average).Average
  $sd = if ($v.Count -gt 1) { [math]::Sqrt((($v | ForEach-Object { ($_ - $m) * ($_ - $m) }) | Measure-Object -Sum).Sum / ($v.Count - 1)) } else { 0 }
  return @{ n = $v.Count; mean = [math]::Round($m, 2); sd = [math]::Round($sd, 2); min = $v[0]; p50 = [math]::Round((Pc 0.5), 2); p95 = [math]::Round((Pc 0.95), 2); max = $v[-1] }
}

function Save-Raw([string]$name, $obj) {
  $p = Join-Path $script:RawDir ($name + '.json')
  $obj | ConvertTo-Json -Depth 8 | Set-Content -Path $p -Encoding UTF8
  Write-Host "gravado: $p"
}

# Memoria/CPU da arvore
function Tree-Mem([int[]]$pids) {
  $pm = 0; $ws = 0; $n = 0
  foreach ($id in $pids) { $p = Get-Process -Id $id -ErrorAction SilentlyContinue; if ($p) { $pm += $p.PrivateMemorySize64; $ws += $p.WorkingSet64; $n++ } }
  return @{ privateBytes = $pm; workingSet = $ws; procs = $n }
}
function Tree-Cpu([int[]]$pids) {
  $h = @{}; foreach ($id in $pids) { $p = Get-Process -Id $id -ErrorAction SilentlyContinue; if ($p) { try { $h[$id] = $p.TotalProcessorTime.TotalSeconds } catch {} } }
  return $h
}
function Cpu-Pct($before, $after, [double]$seconds) {
  $sum = 0.0; foreach ($k in $after.Keys) { if ($before.ContainsKey($k)) { $sum += $after[$k] - $before[$k] } else { $sum += $after[$k] } }
  return [math]::Round(100.0 * $sum / $seconds, 3)   # % de 1 nucleo
}

function Host-Profile([string]$hostName, [string]$kind) { return (Join-Path $script:RunDir ("{0}-{1}" -f $hostName, $kind)) }
