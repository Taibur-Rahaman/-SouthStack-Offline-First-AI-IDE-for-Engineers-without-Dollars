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
