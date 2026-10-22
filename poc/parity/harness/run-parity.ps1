# Harness de paridade Electron x Tauri. Uso:
#   powershell -ExecutionPolicy Bypass -File run-parity.ps1 -HostName electron -Metric M3
# Metric: M1 M2 M3 M4 M5 M6 M7 M8 M9 M11 (M10 = NAO TESTADO, ver results.md). Um host por vez, nunca simultaneos.
# Logs brutos em docs\phase0\parity\raw\<metrica>-<host>.json
param(
  [Parameter(Mandatory)][ValidateSet('electron', 'tauri')][string]$HostName,
  [Parameter(Mandatory)][string]$Metric,
  [int]$N = 3
)
. "$PSScriptRoot\lib.ps1"
$h = $HostName
$ParkX = 1850; $ParkY = 1050     # cursor estacionado longe das janelas (primario 1920x1080)

function Get-HostWin([int[]]$tree) {
  # janela do host = a maior janela visivel dos pids da arvore
  $best = $null; $area = 0
  foreach ($s in [P]::Windows($tree)) {
    $f = $s.Split(','); $a = ([int]$f[3] - [int]$f[1]) * ([int]$f[4] - [int]$f[2])
    if ($a -gt $area) { $area = $a; $best = @{ hwnd = [int64]$f[0]; l = [int]$f[1]; t = [int]$f[2]; r = [int]$f[3]; b = [int]$f[4]; ex = [int64]$f[5] } }
  }
  return $best
}
function Launch([string[]]$a = @(), [string]$kind = 'warm') {
  [P]::SetCursorPos($ParkX, $ParkY) | Out-Null
  $p = Start-Host $h $a (Host-Profile $h $kind)
  $info = Wait-Ready
  return @{ proc = $p; info = $info; tree = (Get-Tree $p.Id) }
}

function M3 {
  $runs = @()
  # warm: um lancamento de preparo (descartado) para criar o perfil/caches, depois 5 medidos
  $kinds = @('cold') * 5 + @('warm') * 5
  $primed = $false
  foreach ($k in $kinds) {
    $prof = Host-Profile $h $k
    if ($k -eq 'cold') { if (Test-Path $prof) { Remove-Item $prof -Recurse -Force } }
    elseif (-not $primed) { $x = Launch @() 'warm'; Stop-Host $x.proc; $primed = $true; Start-Sleep 3 }
    $before = Get-Date
    $x = Launch @() $k
    $start = Epoch $x.proc.StartTime
    $fp = $x.info.firstPaintEpochMs - $start
    $runs += [ordered]@{ kind = $k; startToFirstPaintMs = [math]::Round($fp, 1); pagePerfNowMs = [math]::Round($x.info.firstPaintPerfMs, 1) }
    "{0} {1}: {2} ms (perf.now {3})" -f $h, $k, [math]::Round($fp, 1), [math]::Round($x.info.firstPaintPerfMs, 1)
    Stop-Host $x.proc; Start-Sleep 3
  }
  Save-Raw "M3-$h" @{ host = $h; note = 'frio = perfil novo (cache de arquivos do SO NAO limpo); quente = perfil reutilizado'; runs = $runs
    cold = (Stats ($runs | ? kind -eq 'cold' | % startToFirstPaintMs)); warm = (Stats ($runs | ? kind -eq 'warm' | % startToFirstPaintMs)) }
}

function M1M2idle([int]$wins) {
  $runs = @()
  for ($i = 1; $i -le $N; $i++) {
    $x = Launch @("--windows=$wins") 'warm'
    Start-Sleep 3
    $c0 = Tree-Cpu (Get-Tree $x.proc.Id); $t0 = Get-Date
    Start-Sleep 60
    $secs = ((Get-Date) - $t0).TotalSeconds
    $tree = Get-Tree $x.proc.Id
    $c1 = Tree-Cpu $tree; $m = Tree-Mem $tree
    $r = [ordered]@{ run = $i; windows = $wins; privateMiB = [math]::Round($m.privateBytes / 1MB, 1); workingSetMiB = [math]::Round($m.workingSet / 1MB, 1); procs = $m.procs; cpuPctOfOneCore = (Cpu-Pct $c0 $c1 $secs); seconds = [math]::Round($secs, 1) }
    $runs += $r; ($r | ConvertTo-Json -Compress)
    Stop-Host $x.proc; Start-Sleep 3
  }
  Save-Raw "M1M2idle-$wins`win-$h" @{ host = $h; windows = $wins; runs = $runs; privateMiB = (Stats ($runs | % privateMiB)); workingSetMiB = (Stats ($runs | % workingSetMiB)); cpuPct = (Stats ($runs | % cpuPctOfOneCore)) }
}
function M1 { M1M2idle 1; M1M2idle 3 }
function M2 {
  # idle e coletado junto com M1 (mesma janela de 60 s com animacao em repouso). Aqui: arrasto simulado (cursor em movimento sobre o desenho)
  $runs = @()
  for ($i = 1; $i -le $N; $i++) {
    $x = Launch @() 'warm'
    Start-Sleep 3
    $c0 = Tree-Cpu (Get-Tree $x.proc.Id); $t0 = Get-Date
    [P]::Wiggle(260, 400, 140, 120, 60000, 8)    # elipse sobre o sprite, cruzando suas bordas
    $secs = ((Get-Date) - $t0).TotalSeconds
    $c1 = Tree-Cpu (Get-Tree $x.proc.Id)
    $r = [ordered]@{ run = $i; cpuPctOfOneCore = (Cpu-Pct $c0 $c1 $secs); seconds = [math]::Round($secs, 1) }
    $runs += $r; ($r | ConvertTo-Json -Compress)
    Stop-Host $x.proc; Start-Sleep 3
  }
  Save-Raw "M2sim-$h" @{ host = $h; note = 'cursor em elipse (SetCursorPos a cada ~8 ms) sobre o sprite, sem botao; hover alterna'; runs = $runs; cpuPct = (Stats ($runs | % cpuPctOfOneCore)) }
}

function M4 {
  Add-Type -AssemblyName System.Drawing
  $x = Launch; $s = $x.info.windows[0].scale; $set = [P]::Set($x.tree)
  $w = Get-HostWin $x.tree
  "janela host: $($w.l),$($w.t) -> $($w.r),$($w.b)  scale=$s"
  $rows = @()
  foreach ($f in 0, 2) {
    $bmp = New-Object System.Drawing.Bitmap (Join-Path $script:Parity ("shared\frames\idle\0{0}.png" -f ($f + 1)))
    $alpha = New-Object 'int[,]' 512, 512
    for ($yy = 0; $yy -lt 512; $yy++) { for ($xx = 0; $xx -lt 512; $xx++) { $alpha[$xx, $yy] = $bmp.GetPixel($xx, $yy).A } }
    $bmp.Dispose()
    Send-Cmd "freeze $f" | Out-Null; Start-Sleep -Milliseconds 500
    for ($j = 0; $j -lt 22; $j++) { for ($i = 0; $i -lt 16; $i++) {
      $lx = 10 + 20 * $i; $ly = 10 + 20 * $j
      $exp = $false; $cls = 'solido/vazio'
      if ($lx -ge 4 -and $lx -lt 44 -and $ly -ge 4 -and $ly -lt 44) { $exp = $true; $reg = 'retangulo' }
      elseif ($lx -ge 30 -and $lx -lt 290 -and $ly -ge 170 -and $ly -lt 430) {
        $reg = 'sprite'
        $u = [math]::Floor(($lx - 30) / 260 * 512); $v = [math]::Floor(($ly - 170) / 260 * 512)
        $exp = $alpha[[int]$u, [int]$v] -gt 40
        $cx = [math]::Floor(($lx - 30) / 260 * 64); $cy = [math]::Floor(($ly - 170) / 260 * 64)
        $nOn = 0; for ($bx = 0; $bx -lt 8; $bx++) { for ($by = 0; $by -lt 8; $by++) { if ($alpha[[int]($cx * 8 + $bx), [int]($cy * 8 + $by)] -gt 40) { $nOn++ } } }
        if ($nOn -gt 0 -and $nOn -lt 64) { $cls = 'borda' }
      } else { $reg = 'fora' }
      $px = [int]($w.l + $lx * $s); $py = [int]($w.t + $ly * $s)
      [P]::SetCursorPos($px, $py) | Out-Null; Start-Sleep -Milliseconds 300
      $got = [P]::IsHost($set, $px, $py)
      $rows += [ordered]@{ frame = $f; lx = $lx; ly = $ly; region = $reg; cell = $cls; expected = $exp; got = $got }
    } }
    "frame $f concluido"
  }
  [P]::SetCursorPos($ParkX, $ParkY) | Out-Null
  Send-Cmd 'freeze -1' | Out-Null
  $div = @($rows | ? { $_.expected -ne $_.got })
  $nb = @($rows | ? { $_.cell -eq 'solido/vazio' }); $bd = @($rows | ? { $_.cell -eq 'borda' })
  $sum = [ordered]@{ points = $rows.Count; divergent = $div.Count; divergenceRate = [math]::Round($div.Count / $rows.Count, 4)
    nonBoundaryPoints = $nb.Count; nonBoundaryDivergent = @($nb | ? { $_.expected -ne $_.got }).Count
    boundaryPoints = $bd.Count; boundaryDivergent = @($bd | ? { $_.expected -ne $_.got }).Count
    expectedHitButPassedThrough = @($div | ? { $_.expected }).Count; expectedPassButCaptured = @($div | ? { -not $_.expected }).Count
    expectedHitTotal = @($rows | ? expected).Count }
  $sum | ConvertTo-Json -Compress
  Save-Raw "M4-$h" @{ host = $h; summary = $sum; points = $rows; divergentPoints = $div }
  Stop-Host $x.proc
}

function M5 {
  $runs = @()
  for ($r = 1; $r -le 2; $r++) {
    $x = Launch; $s = $x.info.windows[0].scale; $w = Get-HostWin $x.tree
    $res = [P]::HoverCycles($x.tree, [int]($w.l + 24 * $s), [int]($w.t + 24 * $s), [int]($w.l + 200 * $s), [int]($w.t + 100 * $s), 60, $r)
    $enter = @(); $exit = @()
    for ($c = 0; $c -lt 60; $c++) { $enter += $res[$c * 2]; $exit += $res[$c * 2 + 1] }
    $runs += [ordered]@{ run = $r; enterMs = $enter; exitMs = $exit; enter = (Stats $enter); exit = (Stats $exit)
      enterTimeouts = @($enter | ? { $_ -lt 0 }).Count; exitTimeouts = @($exit | ? { $_ -lt 0 }).Count }
    "run $r enter: " + ((Stats $enter) | ConvertTo-Json -Compress) + " exit: " + ((Stats $exit) | ConvertTo-Json -Compress)
    Stop-Host $x.proc; Start-Sleep 3
  }
  $allE = $runs | % { $_.enterMs } ; $allX = $runs | % { $_.exitMs }
  Save-Raw "M5-$h" @{ host = $h; runs = $runs; enterAll = (Stats $allE); exitAll = (Stats $allX) }
}

function Fg { $hw = [P]::GetForegroundWindow(); return [ordered]@{ hwnd = $hw.ToInt64(); pid = [P]::PidOf($hw); title = [P]::Title($hw) } }
function M6 {
  $runs = @()
  for ($i = 1; $i -le 5; $i++) {
    [P]::SetCursorPos($ParkX, $ParkY) | Out-Null
    $p = Start-Host $h @('--hidden') (Host-Profile $h 'warm')
    $info = Wait-Ready
    $tree = Get-Tree $p.Id
    Start-Sleep 1
    $before = Fg
    Send-Cmd 'show' | Out-Null
    Start-Sleep -Milliseconds 500; $after = Fg
    Start-Sleep -Milliseconds 2000; $after2 = Fg
    $vis = (Send-Cmd 'info').windows[0].visible
    $stolen = $tree -contains $after.pid -or $tree -contains $after2.pid
    $runs += [ordered]@{ run = $i; hostVisibleAfterShow = $vis; before = $before; after500ms = $after; after2500ms = $after2; foregroundChanged = ($before.hwnd -ne $after.hwnd -or $before.hwnd -ne $after2.hwnd); foregroundIsHost = $stolen }
    "run ${i}: changed=$($runs[-1].foregroundChanged) isHost=$stolen before=$($before.pid) after=$($after.pid)"
    Stop-Host $p; Start-Sleep 2
  }
  Save-Raw "M6-$h" @{ host = $h; runs = $runs }
}

function M7 {
  $x = Launch; $s = $x.info.windows[0].scale; $rows = @()
  for ($k = 1; $k -le 20; $k++) {
    Send-Cmd 'move 300 200' | Out-Null; Start-Sleep -Milliseconds 400
    $w0 = Get-HostWin $x.tree
    $cx = [int]($w0.l + 24 * $s); $cy = [int]($w0.t + 24 * $s)
    [P]::Drag($cx, $cy, 200, 100, 10, 15); Start-Sleep -Milliseconds 400
    $w1 = Get-HostWin $x.tree
    $dx = $w1.l - $w0.l; $dy = $w1.t - $w0.t
    $moved = ([math]::Abs($dx) -ge 10 -or [math]::Abs($dy) -ge 10)
    $exact = ([math]::Abs($dx - 200) -le 10 -and [math]::Abs($dy - 100) -le 10)
    $rows += [ordered]@{ drag = $k; startX = $w0.l; startY = $w0.t; dx = $dx; dy = $dy; moved = $moved; withinTolerance10px = $exact }
    "drag ${k}: dx=$dx dy=$dy"
    [P]::SetCursorPos($ParkX, $ParkY) | Out-Null; Start-Sleep -Milliseconds 200
  }
  $sum = [ordered]@{ drags = 20; lost = @($rows | ? { -not $_.moved }).Count; notWithinTolerance = @($rows | ? { -not $_.withinTolerance10px }).Count
    method = $(if ($h -eq 'electron') { 'IPC pointerdown + setBounds (main, 8 ms)' } else { 'data-tauri-drag-region (start_dragging nativo)' }) }
  $sum | ConvertTo-Json -Compress
  Save-Raw "M7-$h" @{ host = $h; summary = $sum; drags = $rows }
  Stop-Host $x.proc
}

function M8 {
  $x = Launch
  $r = Send-Cmd 'tray'
  $r | ConvertTo-Json -Compress
  Save-Raw "M8-$h" @{ host = $h; api = $r; clickTest = 'NAO TESTADO: clique real no icone da bandeja nao e confiavel via automacao' }
  Stop-Host $x.proc
}

function M9 {
  $x = Launch; $rows = @()
  $targets = @(
    @{ name = 'primario'; x = 600; y = 200 },
    @{ name = 'secundario'; x = -2200; y = 100 },
    @{ name = 'secundario_y_negativo'; x = -2200; y = -300 },
    @{ name = 'a_cavalo_dos_monitores'; x = -160; y = 100 },
    @{ name = 'primario_de_volta'; x = 600; y = 200 })
  foreach ($t in $targets) {
    $mv = Send-Cmd ("move {0} {1}" -f $t.x, $t.y)
    Start-Sleep -Milliseconds 500
    $w = Get-HostWin $x.tree; $info = Send-Cmd 'info'; $s = $info.windows[0].scale
    $set = [P]::Set($x.tree)
    # clique/atravessar: retangulo opaco (deve capturar) e area vazia (deve atravessar)
    $inX = [int]($w.l + 24 * $s); $inY = [int]($w.t + 24 * $s); $outX = [int]($w.l + 200 * $s); $outY = [int]($w.t + 100 * $s)
    [P]::SetCursorPos($inX, $inY) | Out-Null; Start-Sleep -Milliseconds 400; $hitIn = [P]::IsHost($set, $inX, $inY)
    [P]::SetCursorPos($outX, $outY) | Out-Null; Start-Sleep -Milliseconds 400; $hitOut = [P]::IsHost($set, $outX, $outY)
    $rows += [ordered]@{ target = $t.name; requestedX = $t.x; requestedY = $t.y; actualX = $w.l; actualY = $w.t; actualW = $w.r - $w.l; actualH = $w.b - $w.t
      hostReportedX = $info.windows[0].x; hostReportedY = $info.windows[0].y; hostScale = $s
      rectCaptures = $hitIn; emptyPassesThrough = (-not $hitOut); positionExact = ($w.l -eq $t.x -and $w.t -eq $t.y) }
    ($rows[-1] | ConvertTo-Json -Compress)
  }
  [P]::SetCursorPos($ParkX, $ParkY) | Out-Null
  Save-Raw "M9-$h" @{ host = $h; displays = $x.info.displays; rows = $rows }
  Stop-Host $x.proc
}

function M11 {
  Add-Type -AssemblyName System.Drawing
  $x = Launch; $s = $x.info.windows[0].scale; $set = [P]::Set($x.tree)
  Send-Cmd 'move 300 200' | Out-Null; Start-Sleep -Milliseconds 500
  $w = Get-HostWin $x.tree
  $inX = [int]($w.l + 24 * $s); $inY = [int]($w.t + 24 * $s)
  function Probe {
    [P]::SetCursorPos($ParkX, $ParkY) | Out-Null; Start-Sleep -Milliseconds 600
    # pixel do retangulo magenta (255,0,255) lido da tela (cursor fora) + hit-test no ponto do retangulo
    $bmp = New-Object System.Drawing.Bitmap 1, 1
    $g = [System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($inX, $inY, 0, 0, (New-Object System.Drawing.Size 1, 1)); $g.Dispose()
    $c = $bmp.GetPixel(0, 0); $bmp.Dispose()
    [P]::SetCursorPos($inX, $inY) | Out-Null; Start-Sleep -Milliseconds 400
    $top = [P]::IsHost($set, $inX, $inY)
    [P]::SetCursorPos($ParkX, $ParkY) | Out-Null
    return [ordered]@{ pixel = ("{0},{1},{2}" -f $c.R, $c.G, $c.B); pixelIsMagenta = ($c.R -gt 200 -and $c.G -lt 60 -and $c.B -gt 200); windowFromPointIsHost = $top }
  }
  $res = [ordered]@{}
  $res.baseline = Probe
  # Cenario A: janela WinForms borderless cobrindo o monitor primario, nao-topmost
  $code = 'Add-Type -AssemblyName System.Windows.Forms; $f=New-Object Windows.Forms.Form; $f.FormBorderStyle="None"; $f.StartPosition="Manual"; $f.Bounds=[Windows.Forms.Screen]::PrimaryScreen.Bounds; $f.BackColor=[Drawing.Color]::DarkBlue; $f.Text="parity-fs"; [void]$f.ShowDialog()'
  $fs = Start-Process powershell -ArgumentList '-NoProfile', '-Command', $code -PassThru -WindowStyle Hidden
  Start-Sleep 4
  $fg = Fg
  $res.scenarioA_borderlessFullscreenForm = Probe
  $res.scenarioA_borderlessFullscreenForm.foregroundPid = $fg.pid; $res.scenarioA_borderlessFullscreenForm.fullscreenFormPid = $fs.Id
  Stop-Process -Id $fs.Id -Force; Start-Sleep 2
  # Cenario B: Edge em quiosque/tela cheia (perfil proprio)
  $edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
  $ep = Join-Path $script:RunDir 'edge-fs'
  $eproc = Start-Process $edge -ArgumentList "--user-data-dir=`"$ep`"", '--kiosk', 'about:blank', '--edge-kiosk-type=fullscreen', '--no-first-run' -PassThru
  Start-Sleep 6
  $fg = Fg
  $res.scenarioB_edgeKiosk = Probe
  $res.scenarioB_edgeKiosk.foregroundPid = $fg.pid; $res.scenarioB_edgeKiosk.edgePid = $eproc.Id; $res.scenarioB_edgeKiosk.edgeTreePids = (Get-Tree $eproc.Id).Count
  foreach ($id in (Get-Tree $eproc.Id)) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }
  Start-Sleep 2
  $res.afterFullscreenClosed = Probe
  Save-Raw "M11-$h" @{ host = $h; results = $res; note = 'Nao inclui tela cheia exclusiva de jogo (DirectX exclusive) nem video em decodificacao por overlay' }
  $res | ConvertTo-Json -Depth 4
  Stop-Host $x.proc
}

foreach ($m in ($Metric -split ',')) { Write-Host "=== $m ($h) ==="; & $m }
