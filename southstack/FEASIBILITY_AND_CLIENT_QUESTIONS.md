# SouthStack: Full Feasibility Study + Client Questions

**CSE 327 – Faculty requirement cover**  
**Demo:** Browser Coding LLM, offline after first load, JS prompt → Console output  
**This doc:** Feasibility study (3 technologies) + Extra engineering challenges + Questions for Faculty

---

# PART 2: Full Feasibility Study Summary

---

## Technology 1: WebLLM (MLC AI)

### Can it run Qwen 1.5B?

**Yes**, if:

- WebGPU is available
- ~8GB RAM (or 6GB with smaller model)
- 4-bit quantized model is used (e.g. `Qwen2.5-Coder-1.5B-Instruct-q4f32_1`)

### Speed

| Hardware           | Tokens per second |
|-------------------|--------------------|
| Integrated GPU     | 5 to 15            |
| Dedicated GPU     | 15 to 35           |

### Problems

- 1GB+ model download (first time)
- Memory pressure on low-RAM machines
- Tab crash risk if model + page use too much RAM

### Solutions

- Smaller 0.5B model as fallback
- Limit `max_tokens` (e.g. 512)
- Context trimming / shorter context window
- Lazy loading: load model only when user first uses AI

---

## Technology 2: WebContainers (StackBlitz)

### Can React / Express run offline?

**Yes**, if:

- On first load, dependencies are cached (e.g. via Service Worker or pre-seed)
- Service worker is implemented for offline asset caching

Express server runs inside the browser tab. Node runtime is emulated via WebAssembly.

### Limitations

- Native Node modules may not work
- Heavy builds (e.g. large npm installs) consume a lot of RAM

---

## Technology 3: Chrome Prompt API (Google)

Runs inside Google Chrome (built-in model, e.g. Gemini Nano).

### Good for

- Low-end laptops
- No model download (pre-installed in browser)

### Bad for

- Not cross-browser (Chrome only)
- Limited customization
- API is experimental and may change

**Best use:** Fallback AI when WebLLM is unavailable or too heavy.

---

# Extra Engineering Challenges

Faculty mentioned: Memory constraints, Hardware acceleration fallback, Caching strategy.  
**These 8 show research depth:**

1. **IndexedDB storage quota limits**  
   Large model + cached assets can hit browser quota.  
   *Mitigation:* Check `navigator.storage.estimate()`, warn user, offer "clear cache" or smaller model.

2. **Model shard corruption recovery**  
   Large download over bad network can corrupt shards.  
   *Mitigation:* Checksums / integrity check; retry or re-download failed shards.

3. **Thermal throttling on low-end laptops**  
   Long inference can cause CPU/GPU throttling and slowdown.  
   *Mitigation:* Limit max tokens, allow user to stop generation, show "warming up" / "cooling" hints.

4. **Service worker update conflicts**  
   New SW version while user is offline can leave app in inconsistent state.  
   *Mitigation:* Version caches, skipWaiting/claim with care, test "offline then refresh" flows.

5. **Multi-language runtime memory explosion**  
   Running Node + Python + Go runtimes in same tab can exhaust RAM.  
   *Mitigation:* One runtime at a time, or lazy-load runtimes only when user selects that language.

6. **Tab freeze during long generation**  
   Heavy LLM can make the tab unresponsive.  
   *Mitigation:* Web Workers for LLM, limit concurrency, show "Busy" state and cancel option.

7. **First load abandonment problem**  
   User may close tab during long model download.  
   *Mitigation:* Resumable download, clear progress (e.g. "Downloading 40%"), optional "light" mode (e.g. 0.5B first).

8. **Browser compatibility fragmentation**  
   WebGPU support varies (Chrome/Edge vs Firefox/Safari).  
   *Mitigation:* Detect WebGPU, show clear message if unsupported; consider Chrome Prompt API as fallback on Chrome.

---

# Part B: Questions for Faculty

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

# Final Summary

## Demo requirement

| Requirement              | Status |
|--------------------------|--------|
| Browser only             | ✔      |
| Offline after first load | ✔      |
| JS prompt                | ✔      |
| Console output           | ✔      |

## Feasibility requirement

| Requirement              | Status |
|--------------------------|--------|
| WebLLM analysis          | ✔      |
| WebContainers analysis  | ✔      |
| Chrome Prompt API analysis | ✔   |
| Engineering challenges  | ✔ (8 items) |
| Client questions        | ✔ (10 questions) |

**সব covered.**

---

**How to run demo:**  
Serve `southstack` over HTTP (e.g. `cd southstack && python3 -m http.server 8000`), open the page in Chrome, open Console, wait for "Model ready." Then run:  
`ask("Write a simple Express server")`  
Output will appear in the console. After first download, turn off internet, reload, and run again to prove offline behaviour.
