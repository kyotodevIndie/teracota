Add-Type -AssemblyName System.Windows.Forms
$f = New-Object Windows.Forms.Form
$f.Text = 'POC_BACKDROP_MAXIMIZED'
$f.FormBorderStyle = 'Sizable'
$f.BackColor = [Drawing.Color]::White
$f.WindowState = 'Maximized'
[Windows.Forms.Application]::Run($f)
