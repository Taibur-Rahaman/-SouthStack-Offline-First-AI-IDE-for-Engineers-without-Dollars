# SouthStack - Quick Start Checklist

## ⚡ 5-Minute Setup

### ✅ Pre-Flight Checklist
- [ ] Google Chrome installed (latest version)
- [ ] 4GB+ RAM available
- [ ] 1GB+ storage free
- [ ] Terminal/command prompt access
- [ ] Internet connection (for first model download)

---

### 🔧 Step 1: Enable WebGPU (1 minute)

1. Open Chrome
2. Paste in address bar: `chrome://flags/#enable-unsafe-webgpu`
3. Click dropdown: set to **Enabled**
4. Click **Relaunch** button
5. Chrome will restart automatically

**Verify**: Open console (F12), type `navigator.gpu` → should return an object (not undefined)

---

### 🚀 Step 2: Start HTTP Server (1 minute)

**Option A: Python** (easiest)
```bash
cd /Users/eloneflax/cse327/southstack
python3 -m http.server 8000
# Server running at http://localhost:8000/
```

**Option B: Bash Script**
```bash
bash /Users/eloneflax/cse327/southstack/start-server.sh
```

**Option C: VS Code Live Server**
- Install extension "Live Server" by Ritwick Dey
- Right-click `index.html` → "Open with Live Server"

---

### 🌐 Step 3: Open in Chrome (30 seconds)

1. Open Chrome
2. Go to: `http://localhost:8000/`
3. You should see **SouthStack Dashboard**

---

### 📥 Step 4: Download Model (30-60 seconds, first time only)

1. Open DevTools: **F12** or **Cmd+Option+I**
2. Go to **Console** tab
3. Watch for messages:
   ```
   📥 Downloading model weights (first time only, ~500MB-1GB)...
   📊 Loading progress: 25%
   📊 Loading progress: 50%
   📊 Loading progress: 75%
   📊 Loading progress: 100%
   ✅ Model loaded successfully
   ```
4. **Wait** until you see "✅ Model loaded successfully"

---

### ✨ Step 5: Test It Works (30 seconds)

In the browser console, type:
```javascript
ask("Write a hello world program in Python")
```

You should see the model's response streaming to the console!

---

## ✅ Verification

After setup, verify everything works:

**WebGPU Status** (console):
```javascript
SouthStack.checkWebGPUSupport()
// Output: { supported: true, message: "WebGPU is available" }
```

**System Info** (console):
```javascript
SouthStack.checkRAM()
// Output: { ramGB: 8, sufficient: true, warning: false }

await SouthStack.checkStorageQuota()
// Output: { quota: 50, usage: 2.5, available: 47.5 }
```

**Offline Mode** (console):
```javascript
// First pre-load model
await SouthStack.ensureInitialized()

// Then go offline:
// DevTools → Network tab → Check "Offline"
// Refresh page (F5)
// Model still works!

ask("This works offline!")
```

---

## 🎯 Common Commands

```javascript
// Ask a question
ask("Write a React component")

// Pre-load model (before going offline)
await SouthStack.ensureInitialized()

// Check system info
SouthStack.checkWebGPUSupport()
SouthStack.checkRAM()
await SouthStack.checkStorageQuota()

// Use fallback model if having memory issues
await SouthStack.initializeEngine('Qwen2.5-Coder-0.5B-Instruct-q4f32_1')
```

---

## 🚨 If Something Goes Wrong

**WebGPU not found?**
- [ ] Go to `chrome://flags/#enable-unsafe-webgpu`
- [ ] Set to **Enabled**
- [ ] Click **Relaunch**
- [ ] Restart browser completely

**Server won't start?**
- [ ] Make sure you're in the `southstack` directory
- [ ] Try: `cd /Users/eloneflax/cse327/southstack`
- [ ] Then: `python3 -m http.server 8000`
- [ ] Check http://localhost:8000/ opens

**Model downloads very slowly?**
- [ ] Check internet speed (should be >5 Mbps)
- [ ] Wait patiently - progress shows percentage
- [ ] Can close and restart - uses cached progress

**"ask()" doesn't work?**
- [ ] Wait for "✅ Model loaded successfully" in console
- [ ] Open DevTools Console (F12)
- [ ] Make sure you're typing in console, not address bar
- [ ] Try: `SouthStack.checkWebGPUSupport()` first

**Offline mode not working?**
- [ ] Model must download completely first
- [ ] Service Worker must be activated (check DevTools → Application)
- [ ] Try: DevTools → Application → Clear Storage → Reload → Download again

---

## 📊 What to Expect

| Phase | Time | What's Happening |
|-------|------|------------------|
| **First Load** | 1-2 min | Downloading ~500-800MB model |
| **Model Load** | 10-30 sec | Loading model into VRAM |
| **First Prompt** | 2-5 sec | Waiting for first response |
| **Subsequent** | 30-60 sec | Generating response |
| **Offline Load** | 5-10 sec | Loading from cache |

---

## 🎓 Example Prompts to Try

```javascript
ask("Write a Python function to find prime numbers")
ask("Explain closures in JavaScript")
ask("Create a SQL query for user statistics")
ask("Design a cache invalidation strategy")
ask("Write a binary search algorithm")
ask("How does OAuth 2.0 work?")
ask("Create a REST API endpoint in Express")
```

---

## ✅ Success!

If you see:
- ✅ SouthStack dashboard loads
- ✅ System banner shows in console
- ✅ WebGPU status is "Available"
- ✅ Model downloads and caches
- ✅ `ask()` function generates responses
- ✅ Works offline after model loads

**You've successfully deployed SouthStack!** 🚀

---

## 📚 Next Steps

1. **Test different prompts** - Try coding, explanation, and design questions
2. **Try offline mode** - Disable internet and see it still works
3. **Explore configuration** - Edit `main.js` to change model, tokens, temperature
4. **Check storage** - See how much cache is used (DevTools → Application)
5. **Monitor performance** - Use DevTools to see GPU/memory usage

---

## 📞 Need Help?

**Common Issues & Solutions**:
- **WebGPU not working** → Update Chrome, enable flag, restart
- **Model download fails** → Check internet, storage space, try again
- **Slow inference** → Close tabs, reduce maxTokens, restart Chrome
- **Offline not working** → Download model fully, check Service Worker cache

**For detailed troubleshooting**: See `DEPLOYMENT_GUIDE.md`

---

**Ready to go? Start with Step 1!** ⚡
