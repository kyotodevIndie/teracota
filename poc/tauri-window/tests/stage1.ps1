. "$PSScriptRoot\common.ps1"
$log = "$PSScriptRoot\stage1.log"
function L($s) { $s | Tee-Object -FilePath $log -Append }
Remove-Item $log -ErrorAction SilentlyContinue
$base = Get-Shot 200 200 700 900
$fgBefore = [W]::FgPid()
L "fg_before_pid=$fgBefore"
$t0 = Get-Date
$p = Start-Process $script:Exe -PassThru
L "app_pid=$($p.Id)"
# cold start: tempo ate o canal de controle responder
$ready = $null
for ($i = 0; $i -lt 400; $i++) { try { $r = Send-Cmd 'get'; $ready = (Get-Date); break } catch { Start-Sleep -Milliseconds 25 } }
L ("T9 cold_start_to_control_ms=" + [int](($ready - $t0).TotalMilliseconds))
$p.Refresh(); L ("T9 mainwindow_handle=" + $p.MainWindowHandle)
Start-Sleep -Seconds 2
$fgAfter = [W]::FgPid()
L "T5 fg_after_pid=$fgAfter app_pid=$($p.Id) same_as_before=$($fgAfter -eq $fgBefore)"
$info = Send-Cmd 'info'; L $info
$i = Parse-Info $info
L "get=$(Send-Cmd 'get')"
# T1
$after = Get-Shot $i.x $i.y $i.w $i.h
$after.Save("$PSScriptRoot\t1_after.png")
$rx0 = [int](60 * $i.sf); $ry0 = [int](120 * $i.sf); $rx1 = [int](260 * $i.sf); $ry1 = [int](320 * $i.sf)
$outDiff = 0; $outTotal = 0; $inRed = 0; $inTotal = 0
for ($yy = 0; $yy -lt $i.h; $yy++) { for ($xx = 0; $xx -lt $i.w; $xx++) {
  $a = $after.GetPixel($xx, $yy); $b = $base.GetPixel($xx, $yy)
  $inside = ($xx -ge $rx0 -and $xx -lt $rx1 -and $yy -ge $ry0 -and $yy -lt $ry1)
  if ($inside) { $inTotal++; if ($a.R -gt 240 -and $a.G -lt 20 -and $a.B -lt 20) { $inRed++ } }
  else { $outTotal++; if ([math]::Abs($a.R - $b.R) + [math]::Abs($a.G - $b.G) + [math]::Abs($a.B - $b.B) -gt 6) { $outDiff++ } }
} }
L "T1 outside_pixels=$outTotal differing_from_baseline=$outDiff ; inside_pixels=$inTotal pure_red=$inRed"
# T2 ignore=true
L "ignore->$(Send-Cmd 'ignore 1')"
$pt = Get-Points $i
$pin = [W]::PidAt($pt.inX, $pt.inY); $pout = [W]::PidAt($pt.outX, $pt.outY)
L "T2 ignore=true pid_inside=$pin pid_outside=$pout app_pid=$($p.Id)"
L "ignore->$(Send-Cmd 'ignore 0')"
$pin = [W]::PidAt($pt.inX, $pt.inY); $pout = [W]::PidAt($pt.outX, $pt.outY)
L "T2-control ignore=false pid_inside=$pin pid_outside=$pout app_pid=$($p.Id)"
# T9 memoria 20 s
Start-Sleep -Seconds 20
$p.Refresh(); L ("T9 workingset_MB_app=" + [math]::Round($p.WorkingSet64 / 1MB, 1))
$wv = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -match 'tauri-window-poc|dev.teracota.poc.window' }
$sum = 0; foreach ($w in $wv) { $q = Get-Process -Id $w.ProcessId -ErrorAction SilentlyContinue; if ($q) { $sum += $q.WorkingSet64 } }
L ("T9 webview2_children=" + @($wv).Count + " workingset_MB_webview2=" + [math]::Round($sum / 1MB, 1))
