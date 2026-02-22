"""Iyakku launcher - GUI (tkinter) or terminal fallback."""
import sys
import subprocess
import threading
import webbrowser
import base64
from io import BytesIO


def main():
    """Main entry point. Tries GUI, falls back to terminal."""
    try:
        import tkinter  # noqa: F401
        run_gui()
    except ImportError:
        run_terminal()


def run_terminal():
    """Fall back to terminal-based startup."""
    from iyakku.app import get_local_ip, get_pin, run_server

    local_ip = get_local_ip()
    port = 8080
    pin = get_pin()
    print(f"\n{'='*50}")
    print(f"  Iyakku - Remote Controller")
    print(f"{'='*50}")
    print(f"  Viewer:     http://{local_ip}:{port}/viewer")
    print(f"  Controller: http://{local_ip}:{port}/controller")
    print(f"  PIN:        {'set' if pin else 'not set (first controller will create one)'}")
    print(f"{'='*50}")
    print(f"  Open the controller URL on your phone")
    print(f"  (same WiFi network)\n")
    run_server(port=port, open_browser=True)


def run_gui():
    """Launch with tkinter GUI."""
    import tkinter as tk
    from tkinter import messagebox
    from PIL import Image, ImageTk, ImageOps
    from iyakku import __version__
    from iyakku.app import (
        get_local_ip, get_pin, generate_qr_base64,
        run_server, set_status_callback, get_resource_path, reset_pin,
    )

    port = 8080
    local_ip = get_local_ip()
    controller_url = f"http://{local_ip}:{port}/controller"
    viewer_url = f"http://{local_ip}:{port}/viewer"

    # ─── Root window ─────────────────────────────
    root = tk.Tk()
    root.title("Iyakku")
    root.configure(bg="#0f1a0f")
    root.geometry("420x650")
    root.resizable(False, False)

    # Try to set window icon (dock/taskbar)
    try:
        icon_path = get_resource_path() / "static" / "icon-512.png"
        if icon_path.exists():
            icon_img = tk.PhotoImage(file=str(icon_path))
            root.iconphoto(True, icon_img)
    except Exception:
        pass

    # ─── Logo + Title ─────────────────────────────
    try:
        icon_path = get_resource_path() / "static" / "icon-512.png"
        logo_pil = Image.open(str(icon_path)).resize((64, 64), Image.LANCZOS)
        logo_photo = ImageTk.PhotoImage(logo_pil)
        logo_label = tk.Label(root, image=logo_photo, bg="#0f1a0f")
        logo_label.image = logo_photo  # prevent GC
        logo_label.pack(pady=(18, 4))
    except Exception:
        pass

    tk.Label(
        root, text="Iyakku",
        font=("Helvetica", 22, "bold"),
        fg="#a0e650", bg="#0f1a0f",
    ).pack(pady=(0, 2))

    tk.Label(
        root, text="Remote Media Controller",
        font=("Helvetica", 11),
        fg="#888888", bg="#0f1a0f",
    ).pack()

    # ─── QR Code ─────────────────────────────────
    qr_b64 = generate_qr_base64(controller_url)
    b64_data = qr_b64.split(",", 1)[1]
    qr_bytes = base64.b64decode(b64_data)
    qr_pil = Image.open(BytesIO(qr_bytes)).resize((200, 200), Image.NEAREST)
    qr_pil = ImageOps.expand(qr_pil, border=10, fill="white")
    qr_photo = ImageTk.PhotoImage(qr_pil)

    qr_label = tk.Label(root, image=qr_photo, bg="#0f1a0f")
    qr_label.image = qr_photo  # prevent GC
    qr_label.pack(pady=(20, 5))

    tk.Label(
        root, text="Scan with your phone to connect",
        font=("Helvetica", 11),
        fg="#888888", bg="#0f1a0f",
    ).pack(pady=(0, 10))

    # ─── "Can't scan?" toggle with hidden URL ────
    url_frame = tk.Frame(root, bg="#0f1a0f")
    url_frame.pack(pady=(0, 5))

    cant_scan_label = tk.Label(
        url_frame, text="Can't scan? Show URL",
        font=("Helvetica", 10), fg="#666666", bg="#0f1a0f",
        cursor="hand2",
    )
    cant_scan_label.pack()

    url_row = tk.Frame(url_frame, bg="#0f1a0f")
    # hidden initially — not packed

    ctrl_label = tk.Label(
        url_row, text=controller_url,
        font=("Helvetica", 10), fg="#a0e650", bg="#0f1a0f",
        cursor="hand2",
    )
    ctrl_label.pack(side=tk.LEFT)
    ctrl_label.bind("<Button-1>", lambda e: webbrowser.open(controller_url))

    copy_label = tk.Label(
        url_row, text="Copy",
        font=("Helvetica", 9), fg="#888888", bg="#0f1a0f",
        cursor="hand2",
    )
    copy_label.pack(side=tk.LEFT, padx=(8, 0))

    def _copy_url(event=None):
        root.clipboard_clear()
        root.clipboard_append(controller_url)
        copy_label.config(text="Copied!", fg="#a0e650")
        root.after(2000, lambda: copy_label.config(text="Copy", fg="#888888"))

    copy_label.bind("<Button-1>", _copy_url)

    _url_visible = [False]

    def _toggle_url(event=None):
        if _url_visible[0]:
            url_row.pack_forget()
            cant_scan_label.config(text="Can't scan? Show URL")
        else:
            url_row.pack(pady=(4, 0))
            cant_scan_label.config(text="Hide URL")
        _url_visible[0] = not _url_visible[0]

    cant_scan_label.bind("<Button-1>", _toggle_url)

    # ─── PIN Status ──────────────────────────────
    pin = get_pin()

    def _pin_display():
        if get_pin():
            return "\U0001F512 PIN Protected", "#a0e650"
        return "\U0001F513 No PIN Set", "#888888"

    pin_text, pin_color = _pin_display()

    pin_frame = tk.Frame(root, bg="#0f1a0f")
    pin_frame.pack(pady=(10, 0))

    pin_label = tk.Label(
        pin_frame, text=pin_text,
        font=("Helvetica", 10), fg=pin_color, bg="#0f1a0f",
    )
    pin_label.pack(side=tk.LEFT)

    def _refresh_pin_label():
        text, color = _pin_display()
        pin_label.config(text=text, fg=color)

    def _reset_pin():
        if not messagebox.askyesno(
            "Reset PIN",
            "Are you sure you want to reset the PIN?\n\n"
            "The next controller to connect will set a new one.",
        ):
            return
        reset_pin()
        _refresh_pin_label()
        reset_pin_label.config(text="Done!", fg="#a0e650")
        root.after(2000, lambda: reset_pin_label.config(text="Reset PIN", fg="#888888"))

    reset_pin_label = tk.Label(
        pin_frame, text="Reset PIN",
        font=("Helvetica", 10), fg="#888888", bg="#0f1a0f",
        cursor="hand2",
    )
    reset_pin_label.pack(side=tk.LEFT, padx=(10, 0))
    reset_pin_label.bind("<Button-1>", lambda e: _reset_pin())

    # ─── Connection Status ───────────────────────
    status_frame = tk.Frame(root, bg="#0f1a0f")
    status_frame.pack(pady=(20, 0))

    status_dot = tk.Canvas(
        status_frame, width=24, height=24,
        bg="#0f1a0f", highlightthickness=0,
    )
    status_dot.create_oval(2, 2, 22, 22, fill="#0f1a0f", outline="", tags="glow")
    status_dot.create_oval(4, 4, 20, 20, fill="#666666", tags="dot")
    status_dot.pack(side=tk.LEFT, padx=(0, 8))

    status_label = tk.Label(
        status_frame, text="Waiting for controller...",
        font=("Helvetica", 12), fg="#888888", bg="#0f1a0f",
    )
    status_label.pack(side=tk.LEFT)

    # ─── Quit Button (canvas-based for macOS color support) ───
    quit_canvas = tk.Canvas(
        root, width=120, height=40,
        bg="#0f1a0f", highlightthickness=0, cursor="hand2",
    )
    quit_canvas.pack(pady=(30, 10))

    _quit_r = 10  # corner radius
    quit_canvas.create_arc(0, 0, 2 * _quit_r, 2 * _quit_r,
                           start=90, extent=90, fill="#e74c3c", outline="")
    quit_canvas.create_arc(120 - 2 * _quit_r, 0, 120, 2 * _quit_r,
                           start=0, extent=90, fill="#e74c3c", outline="")
    quit_canvas.create_arc(0, 40 - 2 * _quit_r, 2 * _quit_r, 40,
                           start=180, extent=90, fill="#e74c3c", outline="")
    quit_canvas.create_arc(120 - 2 * _quit_r, 40 - 2 * _quit_r, 120, 40,
                           start=270, extent=90, fill="#e74c3c", outline="")
    quit_canvas.create_rectangle(_quit_r, 0, 120 - _quit_r, 40,
                                 fill="#e74c3c", outline="")
    quit_canvas.create_rectangle(0, _quit_r, 120, 40 - _quit_r,
                                 fill="#e74c3c", outline="")
    quit_canvas.create_text(60, 20, text="Quit",
                            font=("Helvetica", 13, "bold"), fill="white")

    def _quit_hover(e):
        for item in quit_canvas.find_all():
            if quit_canvas.type(item) != "text":
                quit_canvas.itemconfig(item, fill="#c0392b")

    def _quit_leave(e):
        for item in quit_canvas.find_all():
            if quit_canvas.type(item) != "text":
                quit_canvas.itemconfig(item, fill="#e74c3c")

    quit_canvas.bind("<Enter>", _quit_hover)
    quit_canvas.bind("<Leave>", _quit_leave)
    quit_canvas.bind("<Button-1>", lambda e: on_quit())

    # ─── Version Label ────────────────────────────
    tk.Label(
        root, text=f"v{__version__}",
        font=("Helvetica", 9), fg="#555555", bg="#0f1a0f",
    ).pack(pady=(0, 10))

    # ─── Status callback from socketio ───────────
    connected_count = [0]

    def handle_status(event, data):
        """Called from socketio thread; marshals to tkinter thread."""
        root.after(0, lambda: _update_status(event))

    def _close_viewer_tab():
        """Close the viewer browser tab (best-effort, macOS uses AppleScript)."""
        if sys.platform == "darwin":
            url_frag = f"localhost:{port}/viewer"
            for browser in ("Safari", "Google Chrome"):
                try:
                    subprocess.run(["osascript", "-e",
                        f'tell application "{browser}"\n'
                        f'  repeat with w in windows\n'
                        f'    repeat with t in tabs of w\n'
                        f'      if URL of t contains "{url_frag}" then close t\n'
                        f'    end repeat\n'
                        f'  end repeat\n'
                        f'end tell'
                    ], timeout=3, capture_output=True)
                except Exception:
                    pass

    viewer_opened = [False]

    def _update_status(event):
        if event == "controller_connected":
            connected_count[0] += 1
            status_dot.itemconfig("dot", fill="#a0e650")
            status_dot.itemconfig("glow", fill="#3a5a1a")
            status_label.config(text="Controller connected", fg="#a0e650")
            _refresh_pin_label()
        elif event == "controller_disconnected":
            connected_count[0] = max(0, connected_count[0] - 1)
            if connected_count[0] == 0:
                viewer_opened[0] = False
                status_dot.itemconfig("dot", fill="#666666")
                status_dot.itemconfig("glow", fill="#0f1a0f")
                status_label.config(text="Waiting for controller...", fg="#888888")
                threading.Thread(target=_close_viewer_tab, daemon=True).start()
        elif event == "viewer_open":
            if not viewer_opened[0]:
                viewer_opened[0] = True
                webbrowser.open(viewer_url)

    set_status_callback(handle_status)

    # ─── macOS Accessibility check ───────────────
    if sys.platform == "darwin":
        try:
            import pyautogui
            pyautogui.position()  # lightweight test
        except Exception:
            messagebox.showwarning(
                "Accessibility Permission",
                "Iyakku needs Accessibility permission to control presentations.\n\n"
                "Go to: System Settings > Privacy & Security > Accessibility\n"
                "and add Iyakku.\n\n"
                "Media browsing and viewing will still work without this permission.",
            )

    # ─── Start server thread ─────────────────────
    server_thread = threading.Thread(
        target=lambda: run_server(port=port, open_browser=False),
        daemon=True,
    )
    server_thread.start()

    # ─── Quit handler ────────────────────────────
    def on_quit():
        root.destroy()

    root.protocol("WM_DELETE_WINDOW", on_quit)
    root.mainloop()
