# -*- mode: python ; coding: utf-8 -*-
import sys
from pathlib import Path

block_cipher = None

is_mac = sys.platform == "darwin"
is_win = sys.platform == "win32"

src_path = Path("src/iyakku")

a = Analysis(
    ["src/iyakku/__main__.py"],
    pathex=["src"],
    binaries=[],
    datas=[
        (str(src_path / "templates"), "templates"),
        (str(src_path / "static"), "static"),
    ],
    hiddenimports=[
        "engineio.async_drivers.threading",
        "flask_socketio",
        "PIL",
        "qrcode",
        "pyautogui",
        "tkinter",
        "_tkinter",
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="Iyakku",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    icon="icons/iyakku.icns" if is_mac else "icons/iyakku.ico" if is_win else None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="Iyakku",
)

if is_mac:
    app = BUNDLE(
        coll,
        name="Iyakku.app",
        icon="icons/iyakku.icns",
        bundle_identifier="com.iyakku.app",
        info_plist={
            "CFBundleName": "Iyakku",
            "CFBundleDisplayName": "Iyakku",
            "CFBundleShortVersionString": "1.0.0",
            "CFBundleVersion": "1.0.0",
            "NSHighResolutionCapable": True,
            "NSAppleEventsUsageDescription": "Iyakku needs permission to control presentations.",
            "NSAppleScriptEnabled": True,
        },
    )
