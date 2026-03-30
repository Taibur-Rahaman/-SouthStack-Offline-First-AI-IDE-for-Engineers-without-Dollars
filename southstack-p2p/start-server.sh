#!/bin/zsh
cd "$(dirname "$0")"
echo "Starting SouthStack P2P with auto WebRTC signaling (recommended) on port 8000..."
echo "Open http://localhost:8000 — use “Start session — show link & QR” on the host."
echo "Other devices: http://YOUR_LAN_IP:8000"
echo "Fallback (files only, manual SDP): python3 -m http.server 8000"
exec python3 serve_with_signal.py
