$WshShell = New-Object -ComObject WScript.Shell
$baseDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$shortcutPath = Join-Path $baseDir "동도 롸이팅 마스터.lnk"
$iconPath = Join-Path $baseDir "app_icon.ico"
$targetScript = Join-Path $baseDir "desktop_app.py"
$pythonw = (Get-Command pythonw).Source

$Shortcut = $WshShell.CreateShortcut($shortcutPath)
$Shortcut.TargetPath = $pythonw
$Shortcut.Arguments = "`"$targetScript`""
$Shortcut.WorkingDirectory = $baseDir
$Shortcut.IconLocation = "$iconPath,0"
$Shortcut.Description = "동도 롸이팅 마스터 - 중학 영어작문 1등급 메이커"
$Shortcut.Save()
Write-Host "생성 완료: $shortcutPath"
