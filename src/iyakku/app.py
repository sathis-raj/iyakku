import os
import io
import sys
import json
import base64
import socket
import platform
import subprocess
import time
import webbrowser
from pathlib import Path

from flask import Flask, render_template, request, jsonify, send_file, redirect, url_for, send_from_directory
from flask_socketio import SocketIO, emit
import random
from PIL import Image, ExifTags
import qrcode

try:
    import pyautogui
    pyautogui.PAUSE = 0  # remove default 0.1s delay after each call
    _pyautogui_available = True
except Exception:
    _pyautogui_available = False
    pyautogui = None


def get_resource_path():
    """Return base directory containing templates/ and static/.
    Works for development, pip install, and PyInstaller bundles."""
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        return Path(sys._MEIPASS)
    return Path(__file__).parent


_base = get_resource_path()
app = Flask(__name__,
            template_folder=str(_base / "templates"),
            static_folder=str(_base / "static"))
app.config["SECRET_KEY"] = os.urandom(24).hex()
socketio = SocketIO(app, cors_allowed_origins="*")

# ─── GUI Status Callback ────────────────────────────────────────────────────
_status_callback = None


def set_status_callback(cb):
    """Set a callback for GUI status updates. Signature: cb(event, data)"""
    global _status_callback
    _status_callback = cb


def _notify(event, data=None):
    if _status_callback:
        try:
            _status_callback(event, data or {})
        except Exception:
            pass

# ─── PIN Config ──────────────────────────────────────────────────────────────

CONFIG_FILE = Path.home() / ".iyakku_config.json"
# Migrate legacy config (next to app.py) to home directory
_legacy_config = Path(__file__).parent / ".iyakku_config.json"
if _legacy_config.exists() and not CONFIG_FILE.exists():
    try:
        import shutil
        shutil.copy2(str(_legacy_config), str(CONFIG_FILE))
    except Exception:
        pass


def load_config():
    if CONFIG_FILE.exists():
        try:
            return json.loads(CONFIG_FILE.read_text())
        except Exception:
            pass
    return {}


def save_config(cfg):
    CONFIG_FILE.write_text(json.dumps(cfg, indent=2))


def get_pin():
    """Get saved PIN, or None if not set up yet."""
    cfg = load_config()
    return str(cfg["pin"]) if "pin" in cfg else None


def set_pin(pin):
    """Save a new PIN."""
    cfg = load_config()
    cfg["pin"] = str(pin)
    save_config(cfg)


def reset_pin():
    """Remove the saved PIN so a new one can be set."""
    cfg = load_config()
    cfg.pop("pin", None)
    save_config(cfg)

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".heic", ".tiff", ".tif"}
VIDEO_EXTENSIONS = {".mp4", ".webm", ".mov", ".mkv", ".avi", ".m4v"}
AUDIO_EXTENSIONS = {".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".wma"}
PRESENTATION_EXTENSIONS = {".pptx", ".ppt", ".pdf", ".key", ".odp"}

MIME_TYPES = {
    ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime",
    ".mkv": "video/x-matroska", ".avi": "video/x-msvideo", ".m4v": "video/mp4",
    ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4",
    ".aac": "audio/aac", ".flac": "audio/flac", ".ogg": "audio/ogg",
    ".wma": "audio/x-ms-wma",
}


def get_local_ip():
    """Get the local IP address of this machine."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


def generate_qr_base64(url):
    """Generate a QR code as a base64 data URI."""
    qr = qrcode.QRCode(version=1, box_size=10, border=2)
    qr.add_data(url)
    qr.make(fit=True)
    img = qr.make_image(fill_color="white", back_color="black")
    buffer = io.BytesIO()
    img.save(buffer, format="PNG")
    buffer.seek(0)
    b64 = base64.b64encode(buffer.read()).decode("utf-8")
    return f"data:image/png;base64,{b64}"


def get_roots():
    """Get available filesystem roots / volumes."""
    system = platform.system()
    roots = []
    if system == "Darwin":
        # macOS: /Volumes contains mounted drives
        roots.append({"name": "Home", "path": str(Path.home())})
        volumes_path = Path("/Volumes")
        if volumes_path.exists():
            for vol in sorted(volumes_path.iterdir()):
                if vol.is_dir() and not vol.name.startswith("."):
                    roots.append({"name": vol.name, "path": str(vol)})
    elif system == "Windows":
        import string
        for letter in string.ascii_uppercase:
            drive = f"{letter}:\\"
            if os.path.exists(drive):
                roots.append({"name": drive, "path": drive})
    else:
        # Linux
        roots.append({"name": "Home", "path": str(Path.home())})
        media_path = Path("/media") / os.getenv("USER", "")
        if media_path.exists():
            for vol in sorted(media_path.iterdir()):
                if vol.is_dir():
                    roots.append({"name": vol.name, "path": str(vol)})
        mnt_path = Path("/mnt")
        if mnt_path.exists():
            for vol in sorted(mnt_path.iterdir()):
                if vol.is_dir():
                    roots.append({"name": vol.name, "path": str(vol)})
    return roots


def is_image(filename):
    return Path(filename).suffix.lower() in IMAGE_EXTENSIONS


def is_video(filename):
    return Path(filename).suffix.lower() in VIDEO_EXTENSIONS


def is_audio(filename):
    return Path(filename).suffix.lower() in AUDIO_EXTENSIONS


def is_presentation(filename):
    return Path(filename).suffix.lower() in PRESENTATION_EXTENSIONS


def is_media(filename):
    return is_image(filename) or is_video(filename) or is_audio(filename) or is_presentation(filename)


def get_media_type(filename):
    if is_image(filename):
        return "image"
    if is_video(filename):
        return "video"
    if is_audio(filename):
        return "audio"
    if is_presentation(filename):
        return "presentation"
    return None


# ─── Routes ────────────────────────────────────────────────────────────────────

@app.route("/sw.js")
def service_worker():
    return send_from_directory(app.static_folder, "sw.js",
                               mimetype="application/javascript")


@app.route("/")
def index():
    return redirect(url_for("viewer"))


@app.route("/viewer")
def viewer():
    from iyakku import __version__
    local_ip = get_local_ip()
    port = request.host.split(":")[-1] if ":" in request.host else "8080"
    controller_url = f"http://{local_ip}:{port}/controller"
    qr_data = generate_qr_base64(controller_url)
    pin = get_pin()
    return render_template("viewer.html",
                           controller_url=controller_url,
                           qr_data=qr_data,
                           pin_set=pin is not None,
                           version=__version__)


@app.route("/controller")
def controller():
    response = app.make_response(render_template("controller.html"))
    # Cache the controller page in the browser so PWA cold-starts
    # can serve it even if the service worker was evicted by iOS.
    response.headers["Cache-Control"] = "max-age=300, stale-while-revalidate=86400"
    return response


@app.route("/api/roots")
def api_roots():
    return jsonify(get_roots())


@app.route("/api/browse")
def api_browse():
    path = request.args.get("path", str(Path.home()))
    sort_by = request.args.get("sort", "name")  # name, date, size
    try:
        p = Path(path)
        if not p.exists() or not p.is_dir():
            return jsonify({"error": "Invalid path"}), 400

        folders = []
        media_list = []
        for item in p.iterdir():
            if item.name.startswith("."):
                continue
            if item.is_dir():
                type_counts = {"image": 0, "video": 0, "audio": 0, "presentation": 0}
                capped = False
                try:
                    for root, dirs, files in os.walk(str(item)):
                        dirs[:] = [d for d in dirs if not d.startswith(".") and d not in SKIP_DIRS]
                        for f in files:
                            mt = get_media_type(f)
                            if mt:
                                type_counts[mt] += 1
                        if sum(type_counts.values()) >= 500:
                            capped = True
                            break
                except PermissionError:
                    pass
                media_count = sum(type_counts.values())
                folders.append({
                    "name": item.name, "path": str(item),
                    "media_count": media_count, "type_counts": type_counts,
                    "capped": capped,
                })
            elif is_media(item.name):
                stat = item.stat()
                media_list.append({
                    "name": item.name,
                    "path": str(item),
                    "size": stat.st_size,
                    "modified": stat.st_mtime,
                    "type": get_media_type(item.name),
                })

        folders.sort(key=lambda f: f["name"].lower())

        if sort_by == "date":
            media_list.sort(key=lambda f: f["modified"], reverse=True)
        elif sort_by == "size":
            media_list.sort(key=lambda f: f["size"], reverse=True)
        else:
            media_list.sort(key=lambda f: f["name"].lower())

        parent = str(p.parent) if p.parent != p else None
        return jsonify({"path": str(p), "parent": parent, "folders": folders, "media": media_list})
    except PermissionError:
        return jsonify({"error": "Permission denied"}), 403


SKIP_DIRS = {
    "Library", "node_modules", ".Trash", "__pycache__", ".cache", ".npm",
    ".pyenv", ".local", ".cargo", ".rustup", ".gradle", ".m2", ".cocoapods",
    "venv", ".venv", "env", ".git", ".svn", "Caches", "CacheStorage",
    ".docker", ".kube", "Pods",
}
MAX_RECURSIVE_MEDIA = 2000


def collect_media_recursive(directory, sort_by="name"):
    """Recursively collect media files, skipping heavy system dirs, capped at MAX."""
    media_list = []
    dirs_to_scan = [directory]

    while dirs_to_scan and len(media_list) < MAX_RECURSIVE_MEDIA:
        current = dirs_to_scan.pop(0)
        try:
            for item in sorted(current.iterdir()):
                if item.name.startswith("."):
                    continue
                if item.is_dir():
                    if item.name not in SKIP_DIRS:
                        dirs_to_scan.append(item)
                elif item.is_file() and is_media(item.name):
                    try:
                        stat = item.stat()
                        media_list.append({
                            "name": item.name,
                            "path": str(item),
                            "size": stat.st_size,
                            "modified": stat.st_mtime,
                            "type": get_media_type(item.name),
                        })
                    except (PermissionError, OSError):
                        continue
                if len(media_list) >= MAX_RECURSIVE_MEDIA:
                    break
        except (PermissionError, OSError):
            continue

    if sort_by == "date":
        media_list.sort(key=lambda f: f["modified"], reverse=True)
    elif sort_by == "size":
        media_list.sort(key=lambda f: f["size"], reverse=True)
    else:
        media_list.sort(key=lambda f: f["name"].lower())
    return media_list


@app.route("/api/browse/recursive")
def api_browse_recursive():
    path = request.args.get("path", str(Path.home()))
    sort_by = request.args.get("sort", "name")
    p = Path(path)
    if not p.exists() or not p.is_dir():
        return jsonify({"error": "Invalid path"}), 400
    media_list = collect_media_recursive(p, sort_by)
    return jsonify({"path": str(p), "media": media_list, "total": len(media_list)})


@app.route("/api/search")
def api_search():
    path = request.args.get("path", str(Path.home()))
    query = request.args.get("q", "").lower().strip()
    if not query:
        return jsonify({"media": []})
    p = Path(path)
    if not p.exists() or not p.is_dir():
        return jsonify({"error": "Invalid path"}), 400

    media_list = []
    try:
        for item in p.rglob("*"):
            if item.is_file() and is_media(item.name) and query in item.name.lower():
                try:
                    stat = item.stat()
                    media_list.append({
                        "name": item.name,
                        "path": str(item),
                        "size": stat.st_size,
                        "modified": stat.st_mtime,
                        "type": get_media_type(item.name),
                    })
                except (PermissionError, OSError):
                    continue
    except (PermissionError, OSError):
        pass

    media_list.sort(key=lambda f: f["name"].lower())
    return jsonify({"media": media_list, "total": len(media_list)})


def fix_exif_rotation(img):
    """Rotate image based on EXIF orientation tag."""
    try:
        exif = img._getexif()
        if not exif:
            return img
        orientation_key = next(k for k, v in ExifTags.TAGS.items() if v == "Orientation")
        orientation = exif.get(orientation_key)
        if orientation == 3:
            img = img.rotate(180, expand=True)
        elif orientation == 6:
            img = img.rotate(270, expand=True)
        elif orientation == 8:
            img = img.rotate(90, expand=True)
    except (StopIteration, AttributeError, KeyError):
        pass
    return img


@app.route("/api/image")
def api_image():
    path = request.args.get("path", "")
    p = Path(path)
    if not p.exists() or not p.is_file() or not is_image(p.name):
        return jsonify({"error": "Invalid image"}), 400
    try:
        img = Image.open(str(p))
        img = fix_exif_rotation(img)
        buffer = io.BytesIO()
        fmt = "PNG" if p.suffix.lower() == ".png" else "JPEG"
        img.save(buffer, format=fmt, quality=90)
        buffer.seek(0)
        return send_file(buffer, mimetype=f"image/{fmt.lower()}")
    except Exception:
        return send_file(str(p))


@app.route("/api/thumbnail")
def api_thumbnail():
    """Serve a resized thumbnail (120px) for the controller's thumbnail strip."""
    path = request.args.get("path", "")
    p = Path(path)
    if not p.exists() or not p.is_file() or not is_image(p.name):
        return jsonify({"error": "Invalid image"}), 400
    try:
        img = Image.open(str(p))
        img = fix_exif_rotation(img)
        img.thumbnail((120, 120))
        buffer = io.BytesIO()
        img.save(buffer, format="JPEG", quality=60)
        buffer.seek(0)
        return send_file(buffer, mimetype="image/jpeg")
    except Exception:
        return send_file(str(p))


@app.route("/api/media")
def api_media():
    path = request.args.get("path", "")
    p = Path(path)
    if not p.exists() or not p.is_file():
        return jsonify({"error": "Invalid file"}), 400
    ext = p.suffix.lower()
    mime = MIME_TYPES.get(ext, "application/octet-stream")
    return send_file(str(p), mimetype=mime, conditional=True)


# ─── SocketIO Events ──────────────────────────────────────────────────────────

controllers = set()
active_controller = None  # single controller lock
_viewer_state = None  # last folder_loaded data for new viewer replay
_viewer_photo_index = 0  # last shown photo index


@socketio.on("connect")
def handle_connect():
    print(f"Client connected: {request.sid}")
    # Replay current state to newly connected viewers (e.g. browser just opened)
    if _viewer_state:
        emit("folder_loaded", _viewer_state)
        if _viewer_photo_index > 0:
            emit("show_photo", {"index": _viewer_photo_index})


@socketio.on("check_auth")
def handle_check_auth():
    """Tell the controller whether a PIN has been set up yet."""
    pin = get_pin()
    emit("auth_status", {"pin_set": pin is not None})


@socketio.on("setup_pin")
def handle_setup_pin(data):
    """First-time PIN setup from the controller."""
    global active_controller
    existing = get_pin()
    if existing is not None:
        emit("auth_failed", {"reason": "pin_already_set"})
        return

    pin = str(data.get("pin", ""))
    if len(pin) != 4 or not pin.isdigit():
        emit("auth_failed", {"reason": "invalid_pin_format"})
        return

    set_pin(pin)
    # Auto-authenticate after setup
    active_controller = request.sid
    controllers.add(request.sid)
    emit("auth_success")
    emit("controller_connected", broadcast=True)
    _notify("controller_connected")
    print(f"PIN set and controller registered: {request.sid}")


@socketio.on("register_controller")
def handle_register_controller(data=None):
    global active_controller
    data = data or {}
    pin = str(data.get("pin", ""))
    expected_pin = get_pin()

    # No PIN set yet — reject, must use setup_pin first
    if expected_pin is None:
        emit("auth_failed", {"reason": "no_pin_set"})
        return

    # PIN verification
    if pin != expected_pin:
        emit("auth_failed", {"reason": "invalid_pin"})
        print(f"Controller auth failed (bad PIN): {request.sid}")
        return

    # Single controller lock — allow reconnect of same or if slot is empty
    if active_controller and active_controller != request.sid and active_controller in controllers:
        emit("auth_failed", {"reason": "already_connected"})
        print(f"Controller rejected (already connected): {request.sid}")
        return

    active_controller = request.sid
    controllers.add(request.sid)
    emit("auth_success")
    emit("controller_connected", broadcast=True)
    _notify("controller_connected")
    print(f"Controller registered: {request.sid}")


@socketio.on("disconnect")
def handle_disconnect():
    global active_controller, presentation_active, presentation_file, _viewer_state, _viewer_photo_index
    sid = request.sid
    print(f"Client disconnected: {sid}")
    if sid in controllers:
        controllers.discard(sid)
        if active_controller == sid:
            active_controller = None
        if presentation_active:
            close_presentation(presentation_file)
            presentation_active = False
            presentation_file = None
            emit("presentation_ended", broadcast=True)
        _viewer_state = None
        _viewer_photo_index = 0
        emit("controller_disconnected", broadcast=True)
        _notify("controller_disconnected")


@socketio.on("load_folder")
def handle_load_folder(data):
    """Controller picked a folder - broadcast media list to viewer."""
    path = data.get("path", "")
    sort_by = data.get("sort", "name")
    recursive = data.get("recursive", False)
    p = Path(path)
    if not p.exists() or not p.is_dir():
        return

    if recursive:
        media_list = collect_media_recursive(p, sort_by)
    else:
        media_list = []
        for item in p.iterdir():
            if not item.name.startswith(".") and is_media(item.name):
                try:
                    stat = item.stat()
                    media_list.append({
                        "name": item.name, "path": str(item),
                        "size": stat.st_size, "modified": stat.st_mtime,
                        "type": get_media_type(item.name),
                    })
                except (PermissionError, OSError):
                    continue

        if sort_by == "date":
            media_list.sort(key=lambda f: f["modified"], reverse=True)
        elif sort_by == "size":
            media_list.sort(key=lambda f: f["size"], reverse=True)
        else:
            media_list.sort(key=lambda f: f["name"].lower())

    # Filter out presentations — they're opened natively, not in the browser viewer
    global _viewer_state, _viewer_photo_index
    viewer_media = [m for m in media_list if m["type"] != "presentation"]
    folder_data = {"path": str(p), "media": viewer_media, "all_media": media_list}
    _viewer_state = folder_data
    _viewer_photo_index = 0
    emit("folder_loaded", folder_data, broadcast=True)
    _notify("viewer_open")


@socketio.on("load_search_results")
def handle_load_search_results(data):
    """Controller sends search results to viewer."""
    global _viewer_state, _viewer_photo_index
    media_list = data.get("media", [])
    index = data.get("index", 0)
    folder_data = {"path": "Search Results", "media": media_list}
    _viewer_state = folder_data
    _viewer_photo_index = index
    emit("folder_loaded", folder_data, broadcast=True)
    if index > 0:
        emit("show_photo", {"index": index}, broadcast=True)
    _notify("viewer_open")


@socketio.on("goto_photo")
def handle_goto_photo(data):
    """Controller wants to jump to a specific photo index."""
    global _viewer_photo_index
    _viewer_photo_index = data.get("index", 0)
    emit("show_photo", {"index": _viewer_photo_index}, broadcast=True)


@socketio.on("next_photo")
def handle_next():
    emit("show_next", broadcast=True)


@socketio.on("prev_photo")
def handle_prev():
    emit("show_prev", broadcast=True)


@socketio.on("zoom_change")
def handle_zoom(data):
    emit("apply_zoom", {"scale": data.get("scale", 1)}, broadcast=True)


@socketio.on("pan_change")
def handle_pan(data):
    emit("apply_pan", {"x": data.get("x", 0), "y": data.get("y", 0)}, broadcast=True)


@socketio.on("reset_view")
def handle_reset():
    emit("apply_reset", broadcast=True)


@socketio.on("rotate_photo")
def handle_rotate(data):
    emit("apply_rotation", {"angle": data.get("angle", 0)}, broadcast=True)


@socketio.on("slideshow_start")
def handle_slideshow_start(data):
    emit("start_slideshow", {"interval": data.get("interval", 5)}, broadcast=True)


@socketio.on("slideshow_stop")
def handle_slideshow_stop():
    emit("stop_slideshow", broadcast=True)


@socketio.on("slideshow_tick")
def handle_slideshow_tick(data):
    emit("slideshow_sync", {"index": data.get("index", 0)}, broadcast=True)


@socketio.on("shuffle_photos")
def handle_shuffle(data):
    media_list = data.get("media", [])
    random.shuffle(media_list)
    emit("folder_loaded", {"path": "Shuffled", "media": media_list}, broadcast=True)


@socketio.on("toggle_info")
def handle_toggle_info():
    emit("apply_toggle_info", broadcast=True)


# ─── Media Playback Events ────────────────────────────────────────────────────

@socketio.on("media_play")
def handle_media_play():
    emit("apply_media_play", broadcast=True)


@socketio.on("media_pause")
def handle_media_pause():
    emit("apply_media_pause", broadcast=True)


@socketio.on("media_seek")
def handle_media_seek(data):
    emit("apply_media_seek", {"time": data.get("time", 0)}, broadcast=True)


@socketio.on("media_volume")
def handle_media_volume(data):
    emit("apply_media_volume", {"level": data.get("level", 1)}, broadcast=True)


@socketio.on("media_mute")
def handle_media_mute():
    emit("apply_media_mute", broadcast=True)


@socketio.on("media_time_update")
def handle_media_time_update(data):
    emit("media_sync", {
        "currentTime": data.get("currentTime", 0),
        "duration": data.get("duration", 0),
        "paused": data.get("paused", True),
    }, broadcast=True)


@socketio.on("media_loaded")
def handle_media_loaded(data):
    emit("media_ready", {"duration": data.get("duration", 0)}, broadcast=True)


@socketio.on("playback_blocked")
def handle_playback_blocked():
    emit("playback_blocked", broadcast=True)


@socketio.on("media_ended")
def handle_media_ended():
    emit("media_ended", broadcast=True)


# ─── Presentation Events ──────────────────────────────────────────────────────

presentation_active = False
presentation_file = None


presentation_process = None  # track the opened app process


def _activate_app(app_name):
    """Bring an app to the foreground."""
    system = platform.system()
    if system == "Darwin":
        subprocess.run([
            "osascript", "-e",
            f'tell application "{app_name}" to activate'
        ], timeout=5)
    elif system == "Windows":
        # Use PowerShell to bring a window to front by process name
        # Strip common suffixes for matching
        proc_name = app_name.replace(".exe", "")
        subprocess.run([
            "powershell", "-Command",
            f'(New-Object -ComObject WScript.Shell).AppActivate("{proc_name}")'
        ], timeout=5)
    time.sleep(0.3)


def _send_keys_to_app(app_name, keys_script):
    """Send keystrokes to a specific app via AppleScript System Events (macOS only)."""
    subprocess.run([
        "osascript", "-e",
        f'tell application "{app_name}" to activate\n'
        f'delay 0.3\n'
        f'tell application "System Events"\n'
        f'  {keys_script}\n'
        f'end tell'
    ], timeout=10)


def open_presentation(filepath):
    """Open a presentation file in the native app and start slideshow mode."""
    global presentation_process
    system = platform.system()
    p = Path(filepath)
    ext = p.suffix.lower()

    if system == "Darwin":
        if ext in (".pptx", ".ppt"):
            subprocess.Popen(["open", "-a", "Microsoft PowerPoint", str(p)])
            time.sleep(4)
            # Use AppleScript to start slideshow natively (more reliable than keyboard)
            subprocess.run(["osascript", "-e",
                'tell application "Microsoft PowerPoint"\n'
                '  activate\n'
                '  run slide show slide show settings of active presentation\n'
                'end tell'
            ], timeout=10)
            presentation_process = "powerpoint"
        elif ext == ".key":
            subprocess.Popen(["open", "-a", "Keynote", str(p)])
            time.sleep(3)
            subprocess.run(["osascript", "-e",
                'tell application "Keynote"\n'
                '  activate\n'
                '  start the first slide show of the front document\n'
                'end tell'
            ], timeout=10)
            presentation_process = "keynote"
        elif ext == ".pdf":
            subprocess.Popen(["open", "-a", "Preview", str(p)])
            time.sleep(2)
            _send_keys_to_app("Preview",
                'keystroke "f" using {command down, shift down}')
            presentation_process = "pdf"
        else:
            subprocess.Popen(["open", str(p)])
            presentation_process = "generic"
    elif system == "Windows":
        if ext in (".pptx", ".ppt"):
            # Open file in PowerPoint, wait for it to load, then start slideshow with F5
            os.startfile(str(p))
            time.sleep(4)
            _activate_app("PowerPoint")
            pyautogui.press("f5")
            presentation_process = "powerpoint"
        elif ext == ".pdf":
            os.startfile(str(p))
            time.sleep(2)
            presentation_process = "pdf"
        elif ext == ".odp":
            subprocess.Popen(["soffice", "--show", str(p)])
            presentation_process = "libreoffice"
        else:
            os.startfile(str(p))
            presentation_process = "generic"
    else:
        # Linux
        if ext in (".pptx", ".ppt", ".odp"):
            subprocess.Popen(["libreoffice", "--show", str(p)])
            presentation_process = "libreoffice"
        elif ext == ".pdf":
            subprocess.Popen(["xdg-open", str(p)])
            presentation_process = "pdf"
        else:
            subprocess.Popen(["xdg-open", str(p)])
            presentation_process = "generic"


def close_presentation(filepath):
    """Close the presentation app on exit."""
    global presentation_process
    system = platform.system()
    ext = Path(filepath).suffix.lower() if filepath else ""

    if system == "Darwin":
        if presentation_process == "powerpoint":
            # Exit slideshow via Escape, then close without saving
            subprocess.run(["osascript", "-e",
                'tell application "Microsoft PowerPoint"\n'
                '  activate\n'
                'end tell\n'
                'tell application "System Events"\n'
                '  key code 53\n'  # Escape exits slideshow
                'end tell\n'
                'delay 1.5\n'
                'tell application "Microsoft PowerPoint"\n'
                '  try\n'
                '    close active presentation saving no\n'
                '  end try\n'
                'end tell'
            ], timeout=10)
        elif presentation_process == "keynote":
            subprocess.run(["osascript", "-e",
                'tell application "Keynote"\n'
                '  activate\n'
                'end tell\n'
                'tell application "System Events"\n'
                '  key code 53\n'  # Escape exits slideshow
                'end tell\n'
                'delay 1\n'
                'tell application "Keynote"\n'
                '  try\n'
                '    close the front document without saving\n'
                '  end try\n'
                'end tell'
            ], timeout=10)
        elif presentation_process == "pdf":
            _send_keys_to_app("Preview",
                'key code 53\n'  # Escape fullscreen
                '  delay 0.5\n'
                '  keystroke "w" using {command down}')
        else:
            subprocess.run(["osascript", "-e",
                'tell application "System Events" to key code 53'
            ], timeout=5)
    elif system == "Windows":
        if presentation_process == "powerpoint":
            _activate_app("PowerPoint")
            pyautogui.press("escape")  # exit slideshow
            time.sleep(1)
            pyautogui.hotkey("ctrl", "w")  # close document
            time.sleep(0.5)
            # If no changes were made (typical for viewing), it closes immediately.
            # If a save dialog appears, dismiss with "Don't Save" (Alt+N on English Windows)
            pyautogui.hotkey("alt", "n")
        elif presentation_process == "libreoffice":
            pyautogui.press("escape")  # exit presentation mode
            time.sleep(0.5)
            pyautogui.hotkey("ctrl", "w")
        else:
            pyautogui.hotkey("alt", "F4")
    else:
        # Linux
        if presentation_process == "libreoffice":
            pyautogui.press("escape")  # exit presentation mode
            time.sleep(0.5)
            pyautogui.hotkey("ctrl", "w")
        elif presentation_process == "pdf":
            pyautogui.hotkey("ctrl", "w")
        else:
            pyautogui.press("escape")

    presentation_process = None


@socketio.on("presentation_start")
def handle_presentation_start(data):
    global presentation_active, presentation_file
    filepath = data.get("path", "")
    p = Path(filepath)
    if not p.exists() or not p.is_file() or not is_presentation(p.name):
        emit("presentation_error", {"error": "Invalid presentation file"})
        return
    try:
        open_presentation(filepath)
        presentation_active = True
        presentation_file = filepath
        emit("presentation_started", {"name": p.name, "path": filepath}, broadcast=True)
    except Exception as e:
        emit("presentation_error", {"error": str(e)})


def _press_key(key_code):
    """Send a single key press via AppleScript (avoids pyautogui CGEvent bugs on macOS)."""
    # key codes: right=124, left=123, down=125, up=126, escape=53
    subprocess.Popen(["osascript", "-e",
        f'tell application "System Events" to key code {key_code}'])


def _press_key_with_modifier(key_char, modifier):
    """Send a keystroke with modifier via AppleScript."""
    subprocess.Popen(["osascript", "-e",
        f'tell application "System Events" to keystroke "{key_char}" using {modifier}'])


# macOS key codes
KEY_RIGHT = 124
KEY_LEFT = 123
KEY_DOWN = 125
KEY_UP = 126
KEY_ESCAPE = 53


def _send_key_cross_platform(key_name, key_code):
    """Send a key press to the presentation app, platform-aware."""
    system = platform.system()
    if system == "Darwin":
        _press_key(key_code)
    elif _pyautogui_available:
        pyautogui.press(key_name)


@socketio.on("presentation_next")
def handle_presentation_next():
    if presentation_active:
        _send_key_cross_platform("right", KEY_RIGHT)


@socketio.on("presentation_prev")
def handle_presentation_prev():
    if presentation_active:
        _send_key_cross_platform("left", KEY_LEFT)


@socketio.on("presentation_zoom")
def handle_presentation_zoom(data):
    if presentation_active:
        direction = data.get("direction", "in")
        key = "=" if direction == "in" else "-"
        if platform.system() == "Darwin":
            _press_key_with_modifier(key, "command down")
        else:
            pyautogui.hotkey("ctrl", key)


@socketio.on("presentation_scroll")
def handle_presentation_scroll(data):
    if presentation_active:
        clicks = data.get("clicks", 0)
        if clicks == 0:
            return
        # Always send exactly 1 key press per event
        if clicks > 0:
            _send_key_cross_platform("down", KEY_DOWN)
        else:
            _send_key_cross_platform("up", KEY_UP)


@socketio.on("presentation_exit")
def handle_presentation_exit():
    global presentation_active, presentation_file
    if presentation_active:
        close_presentation(presentation_file)
        presentation_active = False
        presentation_file = None
        emit("presentation_ended", broadcast=True)


# ─── Main ─────────────────────────────────────────────────────────────────────


def run_server(host="0.0.0.0", port=8080, open_browser=True):
    """Start the Flask-SocketIO server. Blocks until server stops."""
    local_ip = get_local_ip()
    if open_browser:
        webbrowser.open(f"http://localhost:{port}/viewer")
    _notify("server_started", {"ip": local_ip, "port": port})
    socketio.run(app, host=host, port=port, debug=False, allow_unsafe_werkzeug=True)


if __name__ == "__main__":
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
