# 🔵 SOUTHSTACK – Complete Execution Plan

**Project:** SouthStack  
**Instructor:** Dr. Nabeel Mohammed  
**Goal:** Fully offline AI IDE inside browser tab.

---

# PART 1: Mandatory Demo Requirement

## 🎯 What You Must Show in Class

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
- **Why 4-bit?** Memory কম লাগে, speed বেশি হয়।

---

## 🧪 Demo Architecture

```
Browser → WebGPU → WebLLM → Qwen Model → Console output
```

No cloud.

---

## 🔧 This Folder: southstack-demo/

- `index.html` loads `main.js`  
- `main.js` loads WebLLM model  
- `window.ask` function expose করবে  

**Console এ:** `ask("Write a simple Express server")` → Model response print করবে।

---

## 🔌 Offline Proof Strategy

1. First time: Internet লাগবে → Model download → Browser cache  
2. তারপর: WiFi off → Reload → Console এ আবার `ask()` চালাও  
3. If output আসে → requirement satisfied ✔  

---

# PART 2–5: Feasibility, Challenges, Client Questions

See **FEASIBILITY_AND_CLIENT_QUESTIONS.md** in this folder (or in `southstack/`) for:

- PART 2: Feasibility Study (WebLLM, WebContainers, Chrome Prompt API)  
- PART 3: 8 Additional Engineering Challenges  
- PART 4: 10 Client Questions  
- PART 5: Action Plan  

---

# ⚠️ WebGPU Check (Critical)

**WebGPU না থাকলে demo শুরুই হবে না。**

- **Chrome version:** 113+ (latest stable better).  
- **Enable:** `chrome://flags/#enable-unsafe-webgpu` → Enabled → Restart.  
- **Check:** `chrome://version` and `chrome://gpu`  
- **Or in Console:** `navigator.gpu ? "WebGPU OK" : "WebGPU NOT supported"`  

**তুমি কি already WebGPU supported browser ব্যবহার করছো? Chrome version কত?**
