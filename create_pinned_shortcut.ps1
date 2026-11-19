param(
    [string]$PythonwPath = ""
)

$Source = @"
using System;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;

[ComImport, Guid("00021401-0000-0000-C000-000000000046"), ClassInterface(ClassInterfaceType.None)]
public class ShellLink {}

[ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("000214F9-0000-0000-C000-000000000046")]
public interface IShellLinkW {
    void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] System.Text.StringBuilder pszFile, int cchMaxPath, IntPtr pfd, uint fFlags);
    void GetIDList(out IntPtr ppidl);
    void SetIDList(IntPtr pidl);
    void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] System.Text.StringBuilder pszName, int cchMaxName);
    void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string pszName);
    void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] System.Text.StringBuilder pszDir, int cchMaxPath);
    void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string pszDir);
    void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] System.Text.StringBuilder pszArgs, int cchMaxPath);
    void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string pszArgs);
    void GetHotkey(out short pwHotkey);
    void SetHotkey(short wHotkey);
    void GetShowCmd(out int piShowCmd);
    void SetShowCmd(int iShowCmd);
    void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] System.Text.StringBuilder pszIconPath, int cchIconPath, out int piIcon);
    void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string pszIconPath, int iIcon);
    void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string pszPathRel, uint dwReserved);
    void Resolve(IntPtr hwnd, uint fFlags);
    void SetPath([MarshalAs(UnmanagedType.LPWStr)] string pszFile);
}

[ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99")]
public interface IPropertyStore {
    uint GetCount();
    void GetAt(uint iProp, out PropertyKey pkey);
    void GetValue(ref PropertyKey key, out PropVariant pv);
    void SetValue(ref PropertyKey key, ref PropVariant pv);
    void Commit();
}

[StructLayout(LayoutKind.Sequential, Pack = 4)]
public struct PropertyKey {
    public Guid fmtid;
    public uint pid;
    public PropertyKey(Guid guid, uint id) { fmtid = guid; pid = id; }
}

[StructLayout(LayoutKind.Explicit)]
public struct PropVariant {
    [FieldOffset(0)] public ushort vt;
    [FieldOffset(8)] public IntPtr pwszVal;
}

public class ShortcutHelper {
    public static void CreateShortcutWithAppId(string shortcutPath, string targetPath, string arguments, string workingDir, string iconPath, string appId) {
        ShellLink link = new ShellLink();
        IShellLinkW shellLink = (IShellLinkW)link;
        shellLink.SetPath(targetPath);
        shellLink.SetArguments(arguments);
        shellLink.SetWorkingDirectory(workingDir);
        shellLink.SetIconLocation(iconPath, 0);

        if (!string.IsNullOrEmpty(appId)) {
            IPropertyStore propStore = (IPropertyStore)link;
            PropertyKey pkey = new PropertyKey(new Guid("{9F4C2855-9F79-48A4-B1F8-F1C288FD07B9}"), 5);
            PropVariant pv = new PropVariant();
            pv.vt = 31; // VT_LPWSTR
            pv.pwszVal = Marshal.StringToCoTaskMemUni(appId);
            propStore.SetValue(ref pkey, ref pv);
            propStore.Commit();
        }

        IPersistFile persistFile = (IPersistFile)link;
        persistFile.Save(shortcutPath, true);
    }
}
"@

Add-Type -TypeDefinition $Source -ErrorAction SilentlyContinue

$baseDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# 1. Use passed PythonwPath if valid
$realPythonw = $null
if ($PythonwPath -and (Test-Path $PythonwPath)) {
    $realPythonw = $PythonwPath
}

# 2. Check LOCALAPPDATA\Python\pythoncore*\pythonw.exe (real non-alias binary)
if (-not $realPythonw) {
    try {
        $cand = Get-ChildItem -Path "$env:LOCALAPPDATA\Python" -Recurse -Filter "pythonw.exe" -ErrorAction SilentlyContinue | Where-Object { $_.FullName -notmatch "WindowsApps" } | Select-Object -First 1 -ExpandProperty FullName
        if ($cand -and (Test-Path $cand)) { $realPythonw = $cand }
    } catch {}
}

# 3. Check Program Files
if (-not $realPythonw) {
    try {
        $cand = Get-ChildItem -Path "$env:ProgramFiles\Python*" -Recurse -Filter "pythonw.exe" -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
        if ($cand -and (Test-Path $cand)) { $realPythonw = $cand }
    } catch {}
}

# 4. Fallback to where pythonw
if (-not $realPythonw) {
    $realPythonw = (Get-Command pythonw -ErrorAction SilentlyContinue).Source
}

$desktopApp = Join-Path $baseDir "desktop_app.py"
$iconPath = Join-Path $baseDir "app_icon.ico"
$appId = "dongdo.writing.master.app.v1"
$arguments = "`"$desktopApp`""

Write-Host "Pythonw 실행기 경로: $realPythonw"

# 1. Project folder shortcut
$folderShortcut = Join-Path $baseDir "동도 롸이팅 마스터.lnk"
[ShortcutHelper]::CreateShortcutWithAppId($folderShortcut, $realPythonw, $arguments, $baseDir, $iconPath, $appId)
Write-Host "폴더 바로가기 등록 완료: $folderShortcut"

# 2. Start Menu Programs shortcut (Required for Windows Shell Taskbar Pinning binding!)
$startMenuDir = [System.IO.Path]::Combine($env:APPDATA, "Microsoft\Windows\Start Menu\Programs")
if (-not (Test-Path $startMenuDir)) {
    New-Item -ItemType Directory -Path $startMenuDir -Force | Out-Null
}
$startMenuShortcut = Join-Path $startMenuDir "동도 롸이팅 마스터.lnk"
[ShortcutHelper]::CreateShortcutWithAppId($startMenuShortcut, $realPythonw, $arguments, $baseDir, $iconPath, $appId)
Write-Host "시작 메뉴 등록 완료 (작업표시줄 고정 연동용): $startMenuShortcut"
