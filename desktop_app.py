import os
import sys
import time
import socket
import threading
import urllib.request
import ctypes
from ctypes import wintypes
import webview

APP_ID = "dongdo.writing.master.app.v1"
APP_TITLE = "동도 롸이팅 마스터 - 중학 영어작문 1등급 메이커"
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ICON_PATH = os.path.join(BASE_DIR, "app_icon.ico")

def setup_windows_taskbar_icon():
    # Set explicit AppUserModelID so Windows groups taskbar under this app with custom icon
    try:
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID(APP_ID)
    except Exception:
        pass

def ensure_taskbar_pinned_shortcut():
    """Ensure Start Menu shortcut with AppUserModelID exists for reliable taskbar pinning."""
    try:
        start_menu_dir = os.path.expandvars(r"%APPDATA%\Microsoft\Windows\Start Menu\Programs")
        shortcut_file = os.path.join(start_menu_dir, "동도 롸이팅 마스터.lnk")
        ps_script = os.path.join(BASE_DIR, "create_pinned_shortcut.ps1")
        if not os.path.exists(shortcut_file) and os.path.exists(ps_script):
            real_pythonw = sys.executable.lower().replace("python.exe", "pythonw.exe")
            import subprocess
            subprocess.run(
                ["powershell", "-ExecutionPolicy", "Bypass", "-File", ps_script, "-PythonwPath", real_pythonw],
                creationflags=0x08000000 if os.name == 'nt' else 0, # CREATE_NO_WINDOW
                timeout=5
            )
    except Exception:
        pass

def apply_window_icon_thread():
    """Continuously tries to find the window and assign WM_SETICON (big and small)"""
    if not os.path.isfile(ICON_PATH):
        return

    IMAGE_ICON = 1
    LR_LOADFROMFILE = 0x00000010
    WM_SETICON = 0x0080
    ICON_SMALL = 0
    ICON_BIG = 1

    try:
        LoadImageW = ctypes.windll.user32.LoadImageW
        LoadImageW.argtypes = [wintypes.HINSTANCE, wintypes.LPCWSTR, wintypes.UINT, ctypes.c_int, ctypes.c_int, wintypes.UINT]
        LoadImageW.restype = wintypes.HANDLE

        SendMessageW = ctypes.windll.user32.SendMessageW
        SendMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
        SendMessageW.restype = ctypes.c_longlong

        FindWindowW = ctypes.windll.user32.FindWindowW
        FindWindowW.argtypes = [wintypes.LPCWSTR, wintypes.LPCWSTR]
        FindWindowW.restype = wintypes.HWND

        hicon_small = LoadImageW(None, ICON_PATH, IMAGE_ICON, 16, 16, LR_LOADFROMFILE)
        hicon_big = LoadImageW(None, ICON_PATH, IMAGE_ICON, 48, 48, LR_LOADFROMFILE)
        if not hicon_big:
            hicon_big = LoadImageW(None, ICON_PATH, IMAGE_ICON, 32, 32, LR_LOADFROMFILE)

        for _ in range(50):
            time.sleep(0.15)
            hwnd = FindWindowW(None, APP_TITLE)
            if hwnd:
                if hicon_small:
                    SendMessageW(hwnd, WM_SETICON, ICON_SMALL, hicon_small)
                if hicon_big:
                    SendMessageW(hwnd, WM_SETICON, ICON_BIG, hicon_big)
                break
    except Exception:
        pass

def is_port_in_use(port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(('127.0.0.1', port)) == 0

def wait_for_server(port, timeout=10):
    start = time.time()
    url = f"http://127.0.0.1:{port}/api/users"
    while time.time() - start < timeout:
        try:
            with urllib.request.urlopen(url, timeout=1) as resp:
                if resp.status == 200:
                    return True
        except Exception:
            time.sleep(0.3)
    return False

def start_backend_server(port):
    import server
    server.run_server(port=port)

def main():
    setup_windows_taskbar_icon()
    threading.Thread(target=apply_window_icon_thread, daemon=True).start()
    threading.Thread(target=ensure_taskbar_pinned_shortcut, daemon=True).start()

    port = 8000
    server_already_running = False

    # Check if existing server is running on port 8000
    if is_port_in_use(port):
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/users", timeout=1) as resp:
                if resp.status == 200:
                    server_already_running = True
        except Exception:
            # Port in use by something else, find a free port
            port = 8001
            while is_port_in_use(port):
                port += 1

    if not server_already_running:
        server_thread = threading.Thread(target=start_backend_server, args=(port,), daemon=True)
        server_thread.start()
        if not wait_for_server(port, timeout=10):
            print(f"Failed to start local server on port {port}")
            sys.exit(1)

    app_url = f"http://127.0.0.1:{port}"

    try:
        # Create native Windows Desktop Window using pywebview (Edge Chromium WebView2)
        window = webview.create_window(
            title="동도 롸이팅 마스터 - 중학 영어작문 1등급 메이커",
            url=app_url,
            width=1280,
            height=860,
            min_size=(960, 640),
            resizable=True,
            fullscreen=False,
            confirm_close=False,
            text_select=True,
            zoomable=True
        )
        webview.start(
            gui="edgechromium",
            debug=False,
            icon=ICON_PATH if os.path.isfile(ICON_PATH) else None
        )
    except Exception as e:
        import webbrowser
        webbrowser.open(app_url)
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            pass
    finally:
        os._exit(0)

if __name__ == "__main__":
    main()
