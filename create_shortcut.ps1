$baseDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$script = Join-Path $baseDir "create_pinned_shortcut.ps1"
powershell -ExecutionPolicy Bypass -File $script
