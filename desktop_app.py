import os
import sys
import time
import socket
import threading
import urllib.request
import webview

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

    webview.start(gui="edgechromium", debug=False)

if __name__ == "__main__":
    main()
