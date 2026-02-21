# 🔵 SOUTHSTACK – Complete Execution Plan

**Project:** SouthStack  
**Instructor:** Dr. Nabeel Mohammed  
**Goal:** Fully offline AI IDE inside browser tab.

---

# PART 1: Mandatory Demo Requirement

## 🎯 What You Must Show in Class

You must prove:

1. LLM runs inside browser
2. No API key
3. No backend
4. JS function দিয়ে prompt পাঠানো যায়
5. Output browser console এ আসে
6. Internet বন্ধ করলে still কাজ করে

---

## 🧠 Technology for Brain

- **Use:** MLC AI WebLLM  
- **Model:** Qwen2.5-Coder-1.5B 4-bit quantized  

**Why 4-bit?** Memory কম লাগে, speed বেশি হয়।

---

## 🧪 Demo Architecture

```
Browser → WebGPU → WebLLM → Qwen Model → Console output
```

No cloud.

---

## 🔧 Minimal Working Code Structure

**Folder:**

```
southstack-demo/
  index.html
  main.js
```

- `index.html` loads `main.js`
- `main.js` loads WebLLM model
- `window.ask` function expose করবে

**Console এ:**

```javascript
ask("Write a simple Express server")
```

Model response print করবে।

---

## 🔌 Offline Proof Strategy

1. **First time:** Internet লাগবে → Model download হবে → Browser cache করবে  
2. **তারপর:** WiFi off → Reload → Console এ আবার `ask()` চালাও  
3. **If output আসে** → requirement satisfied ✔

---

# PART 2: Feasibility Study

---

## 1️⃣ WebLLM / Transformers.js

**Main org:** MLC AI

### Can it run Qwen-2.5-Coder-1.5B?

**Yes**, if:

- WebGPU supported
- 8GB RAM
- 4-bit quantized model

### Expected Speed

| Hardware       | Tokens per second |
|----------------|--------------------|
| Integrated GPU | 5 to 15            |
| Dedicated GPU  | 15 to 35           |

Usable for coding assistant.

### Risks

- 1GB model download
- Tab crash if RAM low
- Slow cold start

### Solutions

- 0.5B fallback model
- Context window limit
- Token limit 512
- Progressive model loading
- Streamed generation

---

## 2️⃣ WebContainers API

**By:** StackBlitz

### Can React or Express run offline?

**Yes**, if:

- First load cached
- Service worker implemented
- Dependencies preinstalled

WebContainers runs Node.js via WASM inside browser.

### Limitations

- Native Node addons not supported
- RAM heavy
- Build tools slow

Still feasible for starter kits.

---

## 3️⃣ Chrome Prompt API

**By:** Google | Uses Gemini Nano

### Good for

- Low-end hardware
- No model download
- Faster startup

### Limitations

- Chrome only
- Experimental
- Limited control
- Not full coder model

**Conclusion:** Good fallback, not primary engine.

---

# PART 3: Additional Engineering Challenges

Faculty mentioned: Memory constraints, Hardware acceleration fallback, Caching strategy.

**You should add (research depth):**

1. IndexedDB storage quota limits  
2. Model shard corruption recovery  
3. Thermal throttling on low-end laptops  
4. Service worker update conflicts  
5. Multi-language runtime memory explosion  
6. Tab freeze during long generation  
7. First load abandonment problem  
8. Browser compatibility fragmentation  

---

# PART 4: Client Questions

**Next class এ এগুলো জিজ্ঞেস করবে:**

1. Minimum supported RAM কত? 4GB acceptable?
2. AI quality vs speed কোনটা বেশি priority?
3. Strict zero network guarantee required?
4. Only JavaScript ecosystem?
5. Python or Go runtime mandatory?
6. Research paper target নাকি startup prototype?
7. Max model size allowed?
8. Should it work on university lab PCs?
9. Offline install time acceptable কত মিনিট?
10. UI minimal acceptable level কী?

---

# PART 5: Immediate Action Plan

## Day 1

- ✔ WebLLM setup  
- ✔ Qwen coder load  
- ✔ Console `ask()` function  
- ✔ Offline test  

## Day 2

- ✔ Write feasibility report  
- ✔ Document risks + solutions  
- ✔ Prepare architecture diagram  

---

# Final SouthStack Vision

```
Browser Tab
  → Local AI Model
  → Local Node runtime
  → IndexedDB storage
  → PWA
  → Fully offline IDE
```

No subscription. No API. No cloud bill.

---

# ⚠️ WebGPU Check (Critical)

**Demo শুরু হওয়ার আগে:**

- WebGPU **না থাকলে** demo চলবে না।  
- **Chrome version:** 113+ (better: latest stable).  
- **Enable:** `chrome://flags/#enable-unsafe-webgpu` → Enabled → Restart.

**Check করো:**

1. Chrome এ যাও `chrome://version` → version number দেখো  
2. `chrome://gpu` → "WebGPU" row এ status দেখো  
3. অথবা demo page open করে Console এ লিখো: `navigator.gpu ? "WebGPU OK" : "WebGPU NOT supported"`

**তুমি কি already WebGPU supported browser ব্যবহার করছো? Chrome version কত?**  
কারণ WebGPU না থাকলে তোমার demo শুরুই হবে না।
