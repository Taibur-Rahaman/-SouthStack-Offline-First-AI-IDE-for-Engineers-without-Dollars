# Unified README
This file merges all README files from the project.
Generated on: 2026-03-30 22:04:01

---

## Unified application

**SouthStack** ships as **one** browser app in **`southstack-p2p/`** (P2P + WebGPU + legacy console APIs). Folders **`southstack/`** and **`southstack-demo/`** redirect to it; see their `README.md` files.

---

## Submission (read this first)

**Graders / quick run:** see **[`SUBMISSION_README.md`](SUBMISSION_README.md)** for the one-command distributed demo, proof JSON paths, and “why this matters.”

**60–90s demo video:** see **[`VIDEO_RECORDING.md`](VIDEO_RECORDING.md)**.

**Demo script + claims:** [`southstack-p2p/FINAL_DEMO_BRIEF.md`](southstack-p2p/FINAL_DEMO_BRIEF.md)

**Task checklist:** [`TODO_MASTER_LIST.md`](TODO_MASTER_LIST.md)

---


## Source: `southstack-p2p/README.md`

# Peer-to-Peer Agentic Coding (SouthStack P2P)

Browser-based multi-device coding assistant: **small LLMs via WebGPU (WebLLM)** + **WebRTC data channels** for shared jobs—plan → delegate subtasks → merge. **No cloud LLM API**; prompts and shared task traffic go **peer-to-peer**.

## New User Quick Run

For first-time users, use this exact flow:

1. Start server:
   ```bash
   cd southstack-p2p
   python3 serve_with_signal.py
   ```
   Windows:
   ```bash
   cd southstack-p2p
   py -3 serve_with_signal.py
   ```
2. Host opens `http://127.0.0.1:8000`.
3. Click **Start session — show link & QR**.
4. Guest device (same Wi-Fi) opens invite link or scans QR, then taps **Join room**.
5. Confirm **Devices in this room** shows `2+`.
6. Ask from chat box; Stop works from host or guest.

If stale assets appear, open once with `?nosw=1`.

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

---

# Master TODO and Checklist
This file merges all TODO/CHECKLIST-style markdown files from the project.
Generated on: 2026-03-30 22:03:28

---


## Source: `README.md`

# CSE 327 — SouthStack workspace

Browser-based **WebGPU LLM** demo (`southstack/`) and **peer-to-peer agentic coding** prototype (`southstack-p2p/`) with WebRTC task sharing—no cloud LLM API for inference.

## New User Quick Run (Recommended)

Use this path for first-time setup on a new machine:

1. Open terminal in this repo.
2. Run:
   ```bash
   cd southstack-p2p
   python3 serve_with_signal.py
   ```
   Windows alternative:
   ```bash
   cd southstack-p2p
   py -3 serve_with_signal.py
   ```
3. On host PC open `http://127.0.0.1:8000`.
4. Click **Start session — show link & QR**.
5. On phone/second laptop (same Wi-Fi), open the invite link / QR and tap **Join room**.
6. Ask from the chat input; coordinator device runs the model.

If UI seems stale, open once with `?nosw=1` (example: `http://192.168.x.x:8000/?nosw=1`).

## Quick links

| What | Where |
|------|--------|
| Run single-browser AI | [`RUN_ON_NEW_PC.md`](RUN_ON_NEW_PC.md) → `southstack/` + `python3 -m http.server 8000` |
| Run P2P + auto invite/QR | `southstack-p2p/` → **`python3 serve_with_signal.py`** (see [`southstack-p2p/README.md`](southstack-p2p/README.md)) |
| Full P2P project documentation (Bangla + English) | [`BROWSER_BASED_P2P_AGENTIC_CODING_SYSTEM.md`](BROWSER_BASED_P2P_AGENTIC_CODING_SYSTEM.md) |
| Instructor / course wording | [`CSE327_FEASIBILITY_BRIEF.md`](CSE327_FEASIBILITY_BRIEF.md) §0 |
| Pre-demo checklist | [`CSE327_DEMO_CHECKLIST.md`](CSE327_DEMO_CHECKLIST.md) |
| Pointer to §0 only | [`CSE327_INSTRUCTOR_PROJECT_STATEMENT.md`](CSE327_INSTRUCTOR_PROJECT_STATEMENT.md) |

## Tests

```bash
npm test
```

Uses Vitest at repo root (not required to run the static web apps).

---


## Source: `southstack/README.md`

# SouthStack - Offline Coding LLM System

A complete offline-first browser-based Coding LLM system that runs entirely in Google Chrome using WebGPU. No backend, no API keys, no internet required after first load.

## 🎯 Features

- ✅ **100% Browser-Based**: Runs entirely in Chrome using WebGPU
- ✅ **Offline-First**: Works without internet after initial model download
- ✅ **No Backend**: Pure static files, no server required
- ✅ **No API Keys**: Completely self-contained
- ✅ **Service Worker Caching**: Automatic caching of model weights and assets
- ✅ **Memory Fallback**: Automatically falls back to smaller model if memory issues occur
- ✅ **Streaming Responses**: Real-time token streaming to console
- ✅ **WebGPU Detection**: Clear warnings if WebGPU unavailable

## Quick Reference

| Task | How |
|------|-----|
| **Enable WebGPU** | Chrome → `chrome://flags/#enable-unsafe-webgpu` → Enabled → Restart |
| **Run first time** | `cd southstack && python3 -m http.server 8000` → open `http://localhost:8000/` → open Console |
| **Test offline** | After model is cached: DevTools → Network → Offline → Reload → `ask("...")` in console |
| **Test memory fallback** | On OOM, app auto-switches to smaller model; or run `await SouthStack.initializeEngine('SmolLM2-360M-Instruct-q4f16_1-MLC')` |
| **Demonstrate in class** | See [Classroom Demonstration](#-classroom-demonstration) below |

## 📋 Prerequisites

1. **Google Chrome** (latest version recommended)
2. **WebGPU Enabled** (see setup steps below)
3. **Sufficient RAM**: 6GB+ recommended (4GB minimum)
4. **Storage Space**: ~500MB-1GB for model weights

## 🚀 Setup Instructions

### Quick Start (Simple Demo)

For fastest demo, use the simple version:

```bash
cd southstack
python3 -m http.server 8000
```

Open `http://localhost:8000/demo-simple.html` → Open Console → Wait for "Model ready." → Run `ask("Write a simple Express server")`

### Full Setup (Complete Version)

### Step 1: Enable WebGPU in Chrome

1. Open Chrome and navigate to: `chrome://flags/#enable-unsafe-webgpu`
2. Set the flag to **Enabled**
3. Restart Chrome

**Alternative**: If the above flag doesn't exist, try:
- `chrome://flags/#enable-webgpu-developer-features`
- Or ensure you're using Chrome 113+ with WebGPU support

### Step 2: Serve the Files (Required)

The app must run from a local HTTP server (ES modules and service workers do not work with `file://`). One command is enough:

#### Option A: Using Python (Recommended)

```bash
cd southstack
python3 -m http.server 8000
```

If you see **"Address already in use"** (port 8000 taken), use another port: `python3 -m http.server 8080` and open `http://localhost:8080/`.

Then open: `http://localhost:8000/` (if serving from inside southstack) or `http://localhost:8000/southstack/` (if serving from parent).

#### Option B: Using Node.js

```bash
cd southstack
npx http-server -p 8000
```

Then open: `http://localhost:8000/`

#### Option C: Using VS Code Live Server

1. Install "Live Server" extension in VS Code
2. Right-click `index.html` → "Open with Live Server"

### Step 3: Run First Time

1. With the server running, open Chrome and go to `http://localhost:8000/` (this serves `index.html`).
2. Open DevTools (F12) → **Console** tab.
3. On first load you will see:
   - Service worker registration
   - Loading progress in console (e.g. "Loading progress: 25%")
   - System banner (WebGPU status, model name, offline status, storage, RAM)
4. Wait until the model is fully downloaded (progress 100%, "Model loaded successfully" on first `ask()` or after `await SouthStack.ensureInitialized()`).

**First load downloads ~500MB–1GB of model weights** (one-time; then cached for offline).

### Step 4: Test Offline Mode

1. After first load completes, open Chrome DevTools
2. Go to **Network** tab → Check "Offline" checkbox
3. Refresh the page
4. The system should load from cache and work offline

## 💻 Usage

### Basic Usage

Open Chrome DevTools Console and use:

```javascript
ask("Write a simple Express server")
```

### Advanced Usage

```javascript
// Pre-initialize the engine
await SouthStack.ensureInitialized()

// Check system status
SouthStack.checkWebGPUSupport()
SouthStack.checkRAM()
await SouthStack.checkStorageQuota()

// Use custom model (must be a WebLLM prebuilt model ID)
await SouthStack.initializeEngine('SmolLM2-360M-Instruct-q4f16_1-MLC')
```

### Example Prompts

```javascript
ask("Write a Python function to calculate fibonacci numbers")
ask("Create a React component for a todo list")
ask("Explain how async/await works in JavaScript")
ask("Write a SQL query to find duplicate records")
```

## 🔧 Configuration

Edit `main.js` to modify:

```javascript
const CONFIG = {
    primaryModel: 'Llama-3.2-1B-Instruct-q4f16_1-MLC',   // Must match WebLLM prebuilt model_list
    fallbackModel: 'SmolLM2-360M-Instruct-q4f16_1-MLC',
    maxTokens: 512,        // Maximum response length
    temperature: 0.2,      // Lower = more deterministic
    minRAMGB: 6           // RAM warning threshold
};
```

## 📁 Project Structure

```
southstack/
├── index.html                          # Main HTML entry point (full version with service worker)
├── main.js                             # Core application logic (full version)
├── demo-simple.html                    # Simple demo version (minimal, no service worker)
├── demo-simple.js                      # Simple demo logic (uses esm.run CDN)
├── service-worker.js                   # Offline caching service worker
├── manifest.json                       # PWA manifest
├── FEASIBILITY_AND_CLIENT_QUESTIONS.md # Feasibility study + 8 engineering challenges + 8 client questions
└── README.md                           # This file
```

### Two Versions Available

1. **Full Version** (`index.html` + `main.js`): Complete implementation with service worker, offline caching, fallback logic, storage checks, RAM warnings, console banner.
2. **Simple Demo** (`demo-simple.html` + `demo-simple.js`): Minimal version for quick demo - just WebLLM + console output. Good for first-time testing.

## 🧪 Testing Checklist

### ✅ WebGPU Detection
- [ ] Open console, check for WebGPU status in banner
- [ ] Should show "✅ WebGPU is available"

### ✅ First Load
- [ ] Model downloads successfully
- [ ] Progress shows in console
- [ ] System banner displays correctly

### ✅ Offline Mode
- [ ] Enable offline in DevTools Network tab
- [ ] Refresh page
- [ ] System loads from cache
- [ ] `ask()` function works offline

### ✅ Memory Fallback
- [ ] If memory error occurs, system should automatically try fallback model
- [ ] Check console for fallback messages

### ✅ Storage Quota
- [ ] Check console banner for storage info
- [ ] Should show available GB

### ✅ RAM Warning
- [ ] If system has < 6GB RAM, should show warning
- [ ] Check console banner

## 🐛 Troubleshooting

### WebGPU Not Available

**Error**: "WebGPU is not available"

**Solution**:
1. Ensure Chrome is updated to latest version
2. Enable WebGPU flag: `chrome://flags/#enable-unsafe-webgpu`
3. Restart Chrome
4. Check GPU support: `chrome://gpu`

### Model Download Fails

**Error**: Network errors during model download

**Solution**:
1. Check internet connection (first load only)
2. Check browser console for specific errors
3. Ensure sufficient storage space (~1GB free)
4. Try clearing cache and retrying

### Service Worker Not Registering

**Error**: Service worker registration fails

**Solution**:
1. Ensure files are served via HTTP (not `file://`)
2. Check browser console for errors
3. Clear site data: DevTools → Application → Clear Storage
4. Re-register service worker

### Memory Errors

**Error**: "Out of memory" or similar

**Solution**:
1. System automatically falls back to smaller model
2. Close other browser tabs
3. Restart Chrome
4. Use fallback model manually: `await SouthStack.initializeEngine('SmolLM2-360M-Instruct-q4f16_1-MLC')`

### Model Not Cached

**Error**: Model downloads every time

**Solution**:
1. Check service worker is active: DevTools → Application → Service Workers
2. Check cache storage: DevTools → Application → Cache Storage
3. Ensure sufficient storage quota
4. Check IndexedDB: DevTools → Application → IndexedDB (WebLLM uses IndexedDB)

## 📊 Performance Notes

- **First Load**: ~30-60 seconds (model download)
- **Subsequent Loads**: ~5-10 seconds (load from cache)
- **Response Time**: ~2-10 seconds per prompt (depends on length)
- **Memory Usage**: ~2-4GB RAM during inference
- **Storage**: ~500MB-1GB for model weights

## 🔒 Security & Privacy

- ✅ All processing happens locally in browser
- ✅ No data sent to external servers
- ✅ Model weights cached locally
- ✅ Works completely offline
- ✅ No API keys or authentication required

## 🎓 Classroom Demonstration

### How to Demonstrate in Class

1. **Let the model fully download** (first time: wait until console shows "Model loaded successfully" and progress 100%).
2. **Turn off the internet** (disable Wi‑Fi or in DevTools → Network → check "Offline").
3. **Reload the page** (F5 or Cmd+R). The app and model should load from cache.
4. **In the console, run:**
   ```javascript
   ask("Write bubble sort in JS")
   ```
5. **Show the output** in the console (streaming response, then full code).

### Demo Script (Optional)

1. **Show WebGPU Status**
   ```javascript
   SouthStack.checkWebGPUSupport()
   ```

2. **Show System Info**
   ```javascript
   await SouthStack.checkStorageQuota()
   SouthStack.checkRAM()
   ```

3. **Demonstrate Offline Capability**
   - Enable offline mode
   - Show `ask()` still works
   - Explain service worker caching

4. **Show Streaming Response**
   ```javascript
   ask("Write a Python hello world program")
   ```

5. **Test Memory Fallback** (if on low-RAM machine)
   - If you see a memory error, the app will automatically try the smaller model (0.5B).
   - Or force fallback: `await SouthStack.initializeEngine('SmolLM2-360M-Instruct-q4f16_1-MLC')`

## 📚 Technical Details

### WebLLM Integration

Uses [MLC AI WebLLM](https://github.com/mlc-ai/web-llm) library:
- Model format: `q4f32_1` (4-bit quantized)
- Inference: WebGPU compute shaders
- Storage: IndexedDB for model weights

### Service Worker Strategy

- **Cache First**: Static assets served from cache
- **Network Fallback**: Model weights fetched on first load
- **Offline Support**: All assets cached for offline use

### Model Information

- **Primary**: Llama-3.2-1B-Instruct (1B parameters)
- **Fallback**: SmolLM2-360M-Instruct (360M parameters)
- **Quantization**: 4-bit (q4f32_1)
- **Format**: HuggingFace compatible

## 🚧 Limitations

- Chrome only (WebGPU requirement)
- Requires sufficient RAM (4GB+)
- Model size limits (larger models may not fit)
- First load requires internet connection
- Response length limited to 512 tokens

## 📝 License

This is a prototype/demonstration system. WebLLM is licensed under Apache 2.0.

## 🙏 Credits

- **WebLLM**: MLC AI team
- **Models**: Qwen team (Alibaba Cloud)
- **WebGPU**: W3C WebGPU Working Group

---

## 📚 Documentation

- **Feasibility Study**: See `FEASIBILITY_AND_CLIENT_QUESTIONS.md` for:
  - Part A: Technical investigation (WebLLM, WebContainers, Chrome Prompt API)
  - Extra engineering challenges (8 items)
  - Part B: Questions for faculty (8 questions)

---

**Built for CSE327 - Systems Engineering**

For issues or questions, check the browser console for detailed error messages.

---


## Source: `southstack-demo/README.md`

# SouthStack Demo

**Goal:** Coding LLM runs in browser, offline after first load. JS sends prompt → output in Console.

## Prerequisite: WebGPU (Critical)

**WebGPU না থাকলে demo শুরুই হবে না。**

- **Chrome version:** 113+ (latest stable recommended). Check: `chrome://version`
- **Enable WebGPU:** `chrome://flags/#enable-unsafe-webgpu` → **Enabled** → **Restart Chrome**
- **Verify:** Open `chrome://gpu` → find "WebGPU" row, or in any page Console run:  
  `navigator.gpu ? "WebGPU OK" : "WebGPU NOT supported"`

**তুমি কি already WebGPU supported browser ব্যবহার করছো? Chrome version কত?**

## Show in Frontend

Use **index-with-ui.html** to type a prompt and see the response on the page:

- Open `http://localhost:8000/index-with-ui.html`
- Wait for **"Model ready"**
- Type a prompt (e.g. "Write a simple Express server") and click **Ask**
- Response appears in the box below (and in console)

## Console-Only (No Frontend)

Use **console-only.html** if you only need console output and no UI:

- Open `http://localhost:8000/console-only.html`
- Open Console (F12) → `ask("your prompt")` → output in console only

## Quick Start (Windows & Mac)

### Step 1: Start the server

**Windows (Command Prompt or PowerShell):**
```cmd
cd southstack-demo
python -m http.server 8000
```
*(If `python` fails, try `py -m http.server 8000`)*

**Mac (Terminal):**
```bash
cd southstack-demo
python3 -m http.server 8000
```

### Step 2: Open in Chrome

- **Windows:** Open Chrome → `http://localhost:8000/` or `http://localhost:8000/index-with-ui.html` (frontend) or `http://localhost:8000/console-only.html`
- **Mac:** Same — Chrome → `http://localhost:8000/` or `http://localhost:8000/index-with-ui.html` or `http://localhost:8000/console-only.html`

### Step 3: Open DevTools Console

| Action        | Windows / Linux | Mac              |
|---------------|-----------------|------------------|
| Open Console  | **F12** or **Ctrl+Shift+J** | **F12** or **Cmd+Option+J** |
| Reload page   | **F5** or **Ctrl+R**       | **F5** or **Cmd+R**         |

### Step 4–6

4. **Wait for:** `"Model ready."` message  
5. **Run:** `ask("Write a simple Express server")`  
6. **Output appears in console**

## First Time vs After Download

| When        | Internet | What happens                          |
|-------------|----------|----------------------------------------|
| First load  | Needed   | Model downloads (~1GB), progress in console |
| After load  | Not needed | Reload with internet off → `ask(...)` works |

## Offline Proof Test

1. **First time:** Let model fully download (wait for "Model ready.")
2. **Turn off internet:** WiFi off OR DevTools → Network → Check "Offline"
3. **Reload page:** **F5** (Windows/Mac) or **Cmd+R** (Mac) or **Ctrl+R** (Windows)
4. **Run:** `ask("Write bubble sort in JS")`
5. **If output appears** → ✅ **Offline requirement satisfied!**

## Proof Checklist

- ✔ Local LLM (WebLLM + Qwen2.5-Coder-1.5B)
- ✔ No internet after first download
- ✔ JS prompt (`ask("...")`)
- ✔ Console output
- ✔ No backend server
- ✔ No API keys
- ✔ Service Worker caching

## Project Structure

```
southstack-demo/
├── index.html              # Main HTML (WebGPU check, instructions)
├── index-with-ui.html      # Frontend: prompt input + response on page
├── console-only.html       # No frontend – console only
├── main.js                 # WebLLM logic, ask() function
├── service-worker.js       # Offline caching
├── README.md               # This file
├── WINDOWS_AND_MAC.md      # Windows & Mac instructions
├── DEMO_GUIDE.md           # Demo guide (Bangla + English)
├── ARCHITECTURE.md         # System architecture diagram
├── FEASIBILITY_AND_CLIENT_QUESTIONS.md  # Feasibility study + questions
└── SOUTHSTACK_EXECUTION_PLAN.md         # Complete execution plan
```

## If Import Fails

If you see a module/import error in console, the CDN may differ. Try:

1. Check internet connection (first load needs it)
2. Use the full **southstack** folder instead (uses fixed CDN path)
3. Or change `main.js` first line to:
   ```javascript
   import { CreateMLCEngine } from "https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.40/lib/index.js";
   ```
   Then use `CreateMLCEngine(...)` directly (no `webllm.` prefix).

## Faculty Requirements

- **Demo:** This folder (browser + offline + JS prompt + console)
- **Feasibility + questions:** See `FEASIBILITY_AND_CLIENT_QUESTIONS.md`
- **Architecture:** See `ARCHITECTURE.md`
- **Execution plan:** See `SOUTHSTACK_EXECUTION_PLAN.md`

## Troubleshooting

### WebGPU Not Available
- Enable flag: `chrome://flags/#enable-unsafe-webgpu`
- Restart Chrome
- Check `chrome://gpu` for WebGPU status

### Model Download Fails
- Check internet connection (first load only)
- Check browser console for specific errors
- Ensure sufficient storage (~1GB free)

### Service Worker Not Registering
- Ensure files served via HTTP (not `file://`)
- Check browser console for errors
- Clear site data: DevTools → Application → Clear Storage

### Memory Errors
- System automatically falls back to 0.5B model
- Close other browser tabs
- Restart Chrome

---

**Ready for demo!** 🚀

---
