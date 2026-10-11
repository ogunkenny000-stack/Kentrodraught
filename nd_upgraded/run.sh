#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  Nigerian International Draughts — launcher
#  Works on macOS (Intel) and Linux.
#  1. Builds the SCAN 3.1 engine if not already compiled.
#  2. Installs Kivy if not present.
#  3. Launches the GUI.
# ─────────────────────────────────────────────────────────────────────────────
set -e
cd "$(dirname "$0")"

# ── Detect OS / compiler ─────────────────────────────────────────────────────
OS="$(uname -s)"

if [ "$OS" = "Darwin" ]; then
    MF="Makefile_macos"
    # Ensure Xcode command-line tools present
    if ! command -v clang++ &>/dev/null; then
        echo "clang++ not found. Install Xcode Command Line Tools:"
        echo "  xcode-select --install"
        exit 1
    fi
else
    MF="Makefile_linux"
    if ! command -v g++ &>/dev/null; then
        echo "g++ not found. Install with: sudo apt install build-essential"
        exit 1
    fi
fi

# ── Build engine if binary is missing or source is newer ─────────────────────
if [ ! -f "scan_nigerian" ] || [ "scan_nigerian" -ot "var.cpp" ] || \
   [ "scan_nigerian" -ot "gen.cpp" ] || [ "scan_nigerian" -ot "list.cpp" ] || \
   [ "scan_nigerian" -ot "pos.cpp" ]; then
    echo "Building SCAN 3.1 Nigerian engine..."
    make -f "$MF" -j"$(sysctl -n hw.ncpu 2>/dev/null || nproc)" scan_nigerian
    echo "Engine built successfully."
fi

# ── Make sure data/eval_nigerian symlink exists ───────────────────────────────
if [ ! -f "data/eval_nigerian" ]; then
    ln -sf eval "data/eval_nigerian"
fi

# ── Python / Kivy check ──────────────────────────────────────────────────────
PY="python3"
if ! command -v "$PY" &>/dev/null; then
    echo "python3 not found. Please install Python 3.9+."
    exit 1
fi

if ! "$PY" -c "import kivy" &>/dev/null; then
    echo "Kivy not found — installing..."
    "$PY" -m pip install kivy --quiet
fi

# ── Launch ───────────────────────────────────────────────────────────────────
echo "Starting Nigerian International Draughts..."
exec "$PY" nigerian_draughts.py
