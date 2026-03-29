# Peer-to-Peer Agentic Coding (SouthStack P2P)

Browser-based multi-device coding assistant: **small LLMs via WebGPU (WebLLM)** + **WebRTC data channels** for shared jobs—plan → delegate subtasks → merge. **No cloud LLM API**; prompts and shared task traffic go **peer-to-peer**.

## Features

- **Multi-laptop / phone guest:** WebRTC mesh; **leader** starts **Start shared job**; guests help run subtasks when they have WebGPU.
- **Local WebGPU LLMs:** WebLLM with small quantized models (see `main.js` `CONFIG.modelCandidates`).
- **Fault-tolerance (prototype):** Leader election (lowest peer id), state broadcast, IndexedDB checkpoints.
- **Offline after cache:** App shell + models cached via service worker + browser storage; first run needs network for CDN/model weights.

## Quick start (two laptops — recommended)

**1. Start signaling + static files** (needed for auto invite / QR / phone join):

```bash
cd southstack-p2p
python3 serve_with_signal.py
```

Default: **http://0.0.0.0:8000** → use `http://<YOUR_LAN_IP>:8000` on other devices.

**2. Host**  
Open that URL in Chrome → **Start session — show link & QR** → set **LAN URL for phones** if needed → **Apply to invite link & QR**.

**3. Guest**  
Same Wi‑Fi → open invite link or scan QR → page tries **auto-join**; if not, scroll to **Guest → Join room** and tap it.

**4. Shared job**  
Only the device marked **(host)** under *Devices in this room* can click **Start shared job**.

**Troubleshooting:** `?nosw=1` bypasses the service worker. Port on the phone must match `serve_with_signal.py` (default 8000). See `index.html` troubleshooting block.

## Fallback: plain HTTP only

```bash
python3 -m http.server 8000 --bind 0.0.0.0
```

No `/api/southstack/*` → use **Advanced — manual WebRTC text** (copy offer/answer between devices).

## Architecture

```
Browser A ─WebRTC── Browser B ─WebRTC── Browser C
  | WebGPU LLM |      | WebGPU LLM |      | WebGPU LLM |
       Plan task → delegate subtasks → merge → shared result
```

Optional **LAN HTTP** in `serve_with_signal.py`: **SDP signaling only**, not model inference.

## Tech stack

- **LLM:** WebLLM (`@mlc-ai/web-llm`) + MLC model IDs in `CONFIG.modelCandidates`
- **P2P:** WebRTC (`RTCPeerConnection`, ordered data channel `agents`)
- **Signaling:** `serve_with_signal.py` → `POST/GET /api/southstack/offer|answer`
- **Storage:** IndexedDB checkpoints (`dbName` in `main.js`)

## Files

| File | Purpose |
|------|---------|
| `index.html` | **Single homepage** — UI, invite flow, Help & AI manual (`#help-guide`), troubleshooting |
| `main.js` | WebLLM, WebRTC, leader, subtasks, sync |
| `sw.js` | Cache strategy; bump version when changing |
| `webgpu-early-compat.js` | WebGPU adapter shims for WebLLM |
| `manifest.json` | PWA metadata |
| `serve_with_signal.py` | Static + minimal signaling API |
| `start-server.sh` | Runs `serve_with_signal.py` by default |

## Requirements

- Chrome (or Chromium) with **WebGPU**, same LAN for typical demos
- STUN: Google default unless `?offline=1` on all peers (LAN-only ICE)

CSE327 — multi-agent / distributed collaboration prototype.
