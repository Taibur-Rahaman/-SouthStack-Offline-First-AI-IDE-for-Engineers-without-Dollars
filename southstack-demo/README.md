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
