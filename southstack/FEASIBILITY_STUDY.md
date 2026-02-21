# SouthStack: Technical Feasibility Study
**CSE 327 – The Great CSE 327 Project**  
**Dr. Nabeel Mohammed**  
**Project:** Offline-First AI IDE for Engineers without Dollars  
**Date:** February 2026

---

## Executive Summary

This feasibility study addresses the technical "floor" of SouthStack: a browser-based, full-stack development environment that runs local AI and local code execution entirely in the browser, with no outgoing data after the initial cache. It answers **Part A** (technical investigation of WebLLM/Transformers.js, WebContainers, and Chrome Prompt API) and prepares **Part B** (questions for the client).

**Key Findings:**
- ✅ **WebLLM**: Can run Qwen-2.5-Coder-1.5B at usable speed (10–30 tokens/sec) on an average laptop; fallbacks and optimizations identified.
- ✅ **WebContainers**: Can run a standard React or Express.js starter kit offline once loaded.
- ⚠️ **Chrome Prompt API (Gemini Nano)**: Viable alternative for low-end hardware with caveats (Chrome-only, 22GB storage, code quality vs. specialized coder models).

---

## Part A: Technical Investigation

### 1. WebLLM / Transformers.js: Coder Model Performance

#### Technology Overview
- **WebLLM**: MLC AI's JavaScript framework for in-browser LLM inference (launched Dec 2024)
- **Transformers.js**: Hugging Face's alternative for browser-based ML models
- **Target Model**: Qwen-2.5-Coder-1.5B-Instruct (1.5B parameters, 4-bit quantized)

#### Performance Analysis

**WebLLM Performance:**
- **Framework Capability**: Retains ~80% of native performance on same device
- **Acceleration**: Uses WebGPU compute shaders + WebAssembly for CPU fallback
- **Storage**: Models cached in IndexedDB (~500MB-1GB for 1.5B model)
- **Quantization**: Supports q4f32_1 (4-bit) for memory efficiency

**Benchmark Data (Server Hardware Reference):**
- **NVIDIA A100 (BF16)**: 39.68 tokens/sec (Transformer), 183.33 tokens/sec (vLLM)
- **WebGPU Performance**: Estimated 10-30 tokens/sec on mid-range GPUs
- **CPU Fallback**: 2-5 tokens/sec on modern CPUs

**Real-World Performance Expectations:**
| Hardware Tier | Expected Tokens/Sec | Usability |
|--------------|---------------------|-----------|
| High-end GPU (RTX 3060+) | 20-40 tokens/sec | ✅ Excellent |
| Mid-range GPU (GTX 1650) | 10-20 tokens/sec | ✅ Good |
| Integrated GPU (Intel Iris) | 5-10 tokens/sec | ⚠️ Acceptable |
| CPU-only (4+ cores) | 2-5 tokens/sec | ⚠️ Slow but usable |

#### Optimization Strategies

**1. Model Quantization:**
- Use 4-bit quantization (q4f32_1) → Reduces model size by 75%
- Current: 1.5B model ≈ 600MB-1GB
- Further: 8-bit quantization possible but quality trade-off

**2. Context Window Management:**
- Limit context to 2048 tokens (vs default 8192)
- Implement sliding window for longer conversations
- Cache frequently used code snippets

**3. Progressive Loading:**
- Load model weights incrementally
- Use streaming for model shards
- Implement model "warm-up" during idle time

**4. Hardware Detection & Fallback:**
```javascript
// Pseudo-code for adaptive model selection
if (gpuVRAM > 4GB && webgpuSupported) {
    model = 'Qwen2.5-Coder-1.5B-Instruct-q4f32_1';
} else if (gpuVRAM > 2GB) {
    model = 'Qwen2.5-Coder-0.5B-Instruct-q4f32_1';
} else {
    model = 'Qwen2.5-Coder-0.5B-Instruct-q4f32_1'; // CPU fallback
}
```

**5. Response Streaming:**
- Stream tokens as generated (already implemented)
- Show partial code immediately
- Cancel generation if user interrupts

**Can these run a Coder model at usable speed?** Yes. On an average laptop (integrated GPU or mid-range discrete), expect **5–20 tokens/sec** with WebLLM + Qwen-2.5-Coder-1.5B. If not (e.g., no WebGPU or very low RAM): use smaller model (0.5B), CPU fallback, or Chrome Prompt API (Gemini Nano).

**Ways to get it to work when performance is poor:** Smaller quantized model, limit context length, stream responses so the user sees output immediately, and offer Gemini Nano as zero-download fallback where available.

#### Feasibility Verdict: ✅ **VIABLE**
- Code completion: Fast enough (<100ms per token)
- Chat-to-code: Acceptable (5-15 seconds for full response)
- Requires: WebGPU support OR CPU fallback with patience

---

### 2. WebContainers API: In-Browser Runtime

**Can this run a standard React or Express.js starter kit without an internet connection once loaded?**  
**Yes.** WebContainers run Node.js natively in the browser with an in-memory (or IndexedDB-persisted) virtual file system. Once the runtime and needed npm packages are cached (e.g., via Service Worker), a standard React or Express starter can install from cache and run with **no internet connection**. First-time setup may require one online session to populate the package cache.

#### Technology Overview
- **WebContainers**: WebAssembly-based OS running Node.js natively in browser
- **Architecture**: Ephemeral virtual file system in browser memory (or IndexedDB)
- **Package Managers**: npm, pnpm, yarn (run in-browser; cached tarballs work offline)

#### Offline Capabilities Analysis

**✅ Fully Offline After Initial Load (with cached packages):**
- Node.js runtime: Runs entirely in browser (no server needed)
- File system: Virtual FS stored in IndexedDB
- Package installation: Pre-cached packages work offline
- HTTP servers: Can run Express/Next.js servers in-browser

**Framework Support:**
| Framework | Offline Support | Notes |
|-----------|----------------|-------|
| React | ✅ Full | Create-react-app works offline |
| Express.js | ✅ Full | HTTP server runs in browser |
| Next.js | ✅ Full | Static + API routes supported |
| Python | ⚠️ Partial | Via Pyodide (WebAssembly Python) |
| Go | ⚠️ Partial | Via WebAssembly Go compiler |

#### Implementation Strategy

**1. Initial Seed Download:**
```javascript
// Cache critical packages on first load
const CRITICAL_PACKAGES = [
    'react@latest',
    'express@latest',
    'next@latest',
    // ... common dependencies
];

// Service Worker caches npm registry responses
// WebContainers uses cached packages offline
```

**2. Storage Management:**
- **IndexedDB**: Store virtual file system
- **Cache API**: Store npm package tarballs
- **Estimate**: ~500MB-2GB for full React + Express stack

**3. Code Execution Flow:**
```
User writes code → Save to IndexedDB → 
WebContainer mounts FS → npm install (from cache) → 
Run server → Preview in iframe
```

#### Limitations & Solutions

**Challenge 1: Package Size**
- **Problem**: Full npm registry too large to cache
- **Solution**: 
  - Pre-cache top 1000 packages
  - Lazy-load packages on demand (if online)
  - Provide "offline mode" with limited packages

**Challenge 2: Python/Go Support**
- **Problem**: Not native like Node.js
- **Solution**:
  - Use Pyodide for Python (WebAssembly)
  - Use TinyGo for Go (compiles to WASM)
  - Performance: ~70% of native speed

**Challenge 3: Port Limitations**
- **Problem**: Browser security restricts ports
- **Solution**: Use WebContainer's built-in port mapping
- Ports are virtual, mapped to browser's internal routing

#### Feasibility Verdict: ✅ **VIABLE**
- Node.js/React/Express: Fully supported offline
- Python/Go: Supported via WebAssembly (slower)
- Requires: Aggressive caching strategy for packages

---

### 3. Chrome Prompt API: Gemini Nano Alternative

#### Technology Overview
- **API**: `window.ai` interface (Chrome 127+)
- **Model**: Gemini Nano (2B or 4B parameters)
- **Hardware**: Automatic GPU/CPU selection
- **Storage**: Shared across origins (efficient)

#### Performance & Capabilities

**Hardware Requirements:**
- **CPU Path**: 16GB RAM, 4+ cores → 2B model
- **GPU Path**: >4GB VRAM → 4B model
- **Storage**: 22GB free space (shared, not per-site)

**Performance Expectations:**
- **GPU Path**: ~15-25 tokens/sec (estimated)
- **CPU Path**: ~5-10 tokens/sec (estimated)
- **Latency**: Lower than WebLLM (no model download)

#### Advantages Over WebLLM

1. **No Model Download**: Pre-installed in Chrome
2. **Better Hardware Detection**: Automatic optimization
3. **Smaller Footprint**: Shared storage, not per-site
4. **Privacy**: Google's privacy guarantees

#### Limitations

1. **Browser Lock-in**: Chrome only (Chrome 127+)
2. **Model Limitations**: Smaller than Qwen-2.5-Coder-1.5B
3. **API Restrictions**: Early preview, may change
4. **Code Quality**: May be inferior to specialized coder models

#### Comparison: Gemini Nano vs Qwen-2.5-Coder

| Feature | Gemini Nano | Qwen-2.5-Coder-1.5B |
|---------|-------------|---------------------|
| Model Size | 2B/4B | 1.5B |
| Code Quality | General purpose | Specialized for code |
| Setup | Zero (built-in) | Download 500MB-1GB |
| Browser Support | Chrome 127+ only | Any WebGPU browser |
| Performance | Good | Excellent (for code) |
| Offline | ✅ Yes | ✅ Yes |

#### Implementation Strategy

**Hybrid Approach:**
```javascript
// Prefer Chrome Prompt API if available, fallback to WebLLM
async function getAICapability() {
    if (window.ai && window.ai.prompt) {
        return {
            type: 'chrome-prompt-api',
            model: 'gemini-nano',
            faster: true,
            noDownload: true
        };
    } else {
        return {
            type: 'webllm',
            model: 'qwen-2.5-coder-1.5b',
            requiresDownload: true
        };
    }
}
```

**Is built-in browser models (Gemini Nano) a viable alternative for low-end hardware?**  
**Yes, with conditions.** Gemini Nano avoids model download (saves ~1GB+ and time), uses Chrome’s built-in optimization, and runs on CPU (16GB RAM, 4+ cores) or GPU (>4GB VRAM). Trade-offs: Chrome-only, 22GB free disk for the shared model, and general-purpose model (weaker for code than Qwen-2.5-Coder). Best used as an optional fallback when WebLLM is unavailable or too heavy.

#### Feasibility Verdict: ⚠️ **CONDITIONAL**
- **Best for**: Low-end hardware, Chrome users
- **Limitation**: Chrome-only, smaller model
- **Recommendation**: Use as fallback, not primary solution

---

## Additional Engineering Challenges (Beyond the Three Technologies)

### Challenge 1: Memory Constraints

**Problem Statement:**
Fitting a 2GB LLM + development environment into a browser tab on limited RAM machines (4-8GB total).

**Impact Analysis:**
- **LLM Model**: ~1-2GB RAM during inference
- **WebContainer**: ~500MB-1GB RAM
- **Browser Overhead**: ~500MB-1GB
- **Total**: ~2-4GB minimum, 4-6GB comfortable

**Solutions:**

1. **Model Swapping:**
   - Unload model when not in use
   - Load on-demand for code generation
   - Use Web Workers to isolate memory

2. **Aggressive Quantization:**
   - 4-bit models (current)
   - Consider 3-bit or 2-bit for extreme cases
   - Quality trade-off acceptable for code completion

3. **Memory Monitoring:**
   ```javascript
   // Detect low memory and adjust behavior
   if (navigator.deviceMemory < 4) {
       useSmallerModel();
       limitConcurrentOperations();
       enableAggressiveGarbageCollection();
   }
   ```

4. **Progressive Enhancement:**
   - Start with code editor only
   - Load AI on user request
   - Load runtime on "Run" button click

**Feasibility**: ✅ **SOLVABLE** with careful memory management

---

### Challenge 2: Hardware Acceleration Fallback

**Problem Statement:**
Ensuring graceful degradation when WebGPU unavailable (old laptops, integrated graphics).

**Fallback Chain:**
```
WebGPU (best) → 
WebGL (fallback) → 
WebAssembly SIMD (CPU) → 
Pure JavaScript (slowest)
```

**Implementation:**
```javascript
async function detectBestAcceleration() {
    if (navigator.gpu) {
        return 'webgpu'; // 20-40 tokens/sec
    } else if (WebGL2 supported) {
        return 'webgl'; // 5-15 tokens/sec
    } else if (WebAssembly SIMD) {
        return 'wasm-simd'; // 2-5 tokens/sec
    } else {
        return 'js'; // 1-2 tokens/sec (unusable)
    }
}
```

**User Experience:**
- Show clear warning if acceleration unavailable
- Recommend Chrome/Edge for best experience
- Provide "lightweight mode" for low-end devices

**Feasibility**: ✅ **SOLVABLE** with multi-tier fallback

---

### Challenge 3: Caching Strategy for Large Downloads

**Problem Statement:**
Managing 500MB-2GB initial download on flaky connections without failing.

**Solutions:**

1. **Resumable Downloads:**
   - Use Service Worker + Cache API
   - Implement chunked download with resume
   - Store download progress in IndexedDB

2. **Progressive Caching:**
   ```javascript
   // Cache critical files first
   const PRIORITY_FILES = [
       'model-shard-0.bin', // First 100MB
       'model-shard-1.bin', // Next 100MB
       // ... rest can load in background
   ];
   ```

3. **Background Sync:**
   - Use Background Sync API
   - Resume downloads when connection restored
   - Show progress indicator

4. **CDN Redundancy:**
   - Multiple CDN sources (jsDelivr, unpkg, etc.)
   - Automatic failover
   - Parallel downloads from multiple sources

5. **Compression:**
   - Use Brotli compression for model weights
   - ~30% size reduction
   - Decompress on client side

**Feasibility**: ✅ **SOLVABLE** with robust download manager

---

### Challenge 4: Code Editor Integration

**Problem Statement:**
Integrating AI code completion into a code editor (Monaco, CodeMirror, etc.).

**Requirements:**
- Real-time autocomplete
- Inline suggestions
- Chat panel for "chat-to-code"
- Error detection and fixes

**Solutions:**

1. **Monaco Editor Integration:**
   ```javascript
   // Monaco's completion provider
   monaco.languages.registerCompletionItemProvider('javascript', {
       provideCompletionItems: async (model, position) => {
           const context = getCodeContext(model, position);
           const suggestions = await ai.complete(context);
           return { suggestions };
       }
   });
   ```

2. **LSP (Language Server Protocol):**
   - Use WebLLM as LSP backend
   - Standard protocol for IDE features
   - Works with any LSP-compatible editor

3. **Incremental Updates:**
   - Stream tokens as generated
   - Update editor in real-time
   - Allow user to accept/reject suggestions

**Feasibility**: ✅ **SOLVABLE** with standard editor APIs

---

### Challenge 5: Multi-Language Support

**Problem Statement:**
Supporting Python, Go, JavaScript, TypeScript, etc. in browser runtime.

**Current State:**
- ✅ JavaScript/TypeScript: Native via WebContainers
- ⚠️ Python: Via Pyodide (WebAssembly)
- ⚠️ Go: Via TinyGo (compiles to WASM)
- ❌ Rust, C++: Not directly supported

**Solutions:**

1. **Language-Specific Runtimes:**
   - Python: Pyodide (full CPython in WASM)
   - Go: TinyGo compiler → WASM
   - Rust: Compile to WASM (ahead of time)

2. **Unified Execution Interface:**
   ```javascript
   class LanguageRuntime {
       async execute(code, language) {
           switch(language) {
               case 'javascript': return webcontainer.run(code);
               case 'python': return pyodide.runPython(code);
               case 'go': return compileAndRunGo(code);
           }
       }
   }
   ```

3. **Performance Trade-offs:**
   - JavaScript: 100% native speed
   - Python: ~70% native speed (Pyodide)
   - Go: ~60% native speed (WASM)

**Feasibility**: ⚠️ **PARTIALLY SOLVABLE**
- JavaScript/TypeScript: Excellent
- Python: Good (Pyodide mature)
- Go: Acceptable (TinyGo limitations)
- Other languages: Limited

---

## Part B: Questions for the Client

*Prepared so the team can ask the client (Dr. Nabeel Mohammed) about product and technical expectations before implementation.*

### Product & User Experience Questions

1. **Target User Base:**
   - What's the minimum hardware spec we should support? (e.g., 4GB RAM, integrated GPU?)
   - Should we prioritize code quality or speed?

2. **Feature Prioritization:**
   - Which is more important: code completion or chat-to-code?
   - Do we need real-time collaboration, or single-user only?
   - Should we support mobile browsers, or desktop-only?

3. **Language Support:**
   - Which languages are must-haves? (JavaScript, Python, Go?)
   - Can we start with JavaScript/TypeScript only and add others later?

4. **Offline Strategy:**
   - How "offline" should it be? (No internet ever after first load?)
   - Can we allow optional online features? (e.g., npm package search)

5. **Performance Expectations:**
   - What's acceptable response time for code generation? (5s? 15s?)
   - Is 10 tokens/sec acceptable, or do we need 20+?

6. **Deployment:**
   - Should this be a web app, PWA, or Electron app?
   - Do we need a landing page, or just the IDE?

### Technical Architecture Questions

7. **Model Selection:**
   - Should we use Qwen-2.5-Coder (specialized) or Gemini Nano (built-in)?
   - Can we support multiple models and let users choose?

8. **Storage Limits:**
   - How much storage can we assume users have? (1GB? 5GB?)
   - Should we implement storage quota management?

9. **Security:**
   - How should we handle user code? (Sandboxed? Can it access local files?)
   - Do we need code execution limits? (timeouts, memory limits?)

10. **Caching Strategy:**
    - Should we cache user's code projects? (How many?)
    - How do we handle cache eviction?

---

## Recommendations

### Phase 1: MVP (Minimum Viable Product)
1. ✅ WebLLM integration with Qwen-2.5-Coder-1.5B
2. ✅ Basic code editor (Monaco Editor)
3. ✅ WebContainers for Node.js/React execution
4. ✅ Service Worker for offline caching
5. ✅ Simple chat-to-code interface

### Phase 2: Enhancement
1. Code completion (autocomplete)
2. Python support via Pyodide
3. Memory optimization
4. Better error handling

### Phase 3: Advanced Features
1. Multi-language support (Go, Rust)
2. Collaboration features
3. Project templates
4. Advanced caching strategies

---

## Conclusion

**Overall Feasibility: ✅ VIABLE**

The core technologies (WebLLM, WebContainers, Chrome Prompt API) are mature enough to build SouthStack. The main challenges are:

1. **Memory management** - Solvable with careful optimization
2. **Hardware fallback** - Solvable with multi-tier acceleration
3. **Large downloads** - Solvable with resumable downloads
4. **Performance** - Acceptable for target use case (10-30 tokens/sec)

**Risk Assessment:**
- **Low Risk**: WebContainers, Service Workers, PWA
- **Medium Risk**: WebLLM performance on low-end hardware
- **High Risk**: Memory constraints on 4GB RAM machines

**Next Steps:**
1. Build MVP prototype
2. Test on target hardware (4GB RAM, integrated GPU)
3. Iterate based on performance data
4. Add features incrementally

---

**Document Version:** 1.0  
**Last Updated:** February 2026
