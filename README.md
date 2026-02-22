# Iyakku

Remote media controller — control your laptop's photos, videos, audio, and presentations from your phone.

## How It Works

1. **Launch Iyakku** on your laptop
2. **Scan the QR code** with your phone (or open the URL)
3. **Browse and control** media from your phone — it plays on the laptop

Your phone becomes a remote control. Both devices must be on the same WiFi network.

## Install & Run

### Option A: Download the app (non-technical users)

1. Download the latest release for your platform from [Releases](https://github.com/sathisraj/iyakku/releases):
   - **macOS (Apple Silicon)**: `Iyakku-macOS-arm64.zip`
   - **macOS (Intel)**: `Iyakku-macOS-x86_64.zip`
   - **Windows**: `Iyakku-Windows-x64.zip`
2. Unzip the downloaded file
3. **Double-click** `Iyakku.app` (macOS) or `Iyakku.exe` (Windows) to launch
4. A window will appear with a QR code — scan it with your phone

> **macOS note**: On first launch, right-click the app and select "Open" to bypass Gatekeeper. You'll also be prompted to allow network access and (for presentation control) Accessibility permissions.

### Option B: pip install

```bash
pip install iyakku
iyakku
```

This opens a GUI window with the QR code. Alternatively, run in terminal-only mode:

```bash
python -m iyakku
```

### Option C: Run from source (developers)

```bash
git clone https://github.com/sathisraj/iyakku.git
cd iyakku
pip install -e .
iyakku
```

Or without installing:

```bash
pip install -r requirements.txt
python src/iyakku/app.py
```

### Building the standalone app yourself

```bash
pip install -e ".[dev]"
pyinstaller iyakku.spec
```

This creates:
- **macOS**: `dist/Iyakku.app` — double-click to run
- **Windows**: `dist/Iyakku/Iyakku.exe` — double-click to run

## Features

- **Photos**: Browse folders, view images with zoom/pan/rotate, slideshow mode, shuffle
- **Video & Audio**: Play/pause, seek, volume control, skip forward/back
- **Presentations**: Open PowerPoint, Keynote, PDF in native apps and control slides from your phone
- **Search**: Find media files by name across subfolders
- **PWA**: Add the controller to your phone's home screen for an app-like experience

## Requirements

- Python 3.9+ (only if installing via pip)
- Same WiFi network for laptop and phone
- macOS, Windows, or Linux
