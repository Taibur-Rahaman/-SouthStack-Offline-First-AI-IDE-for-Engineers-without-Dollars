/**
 * SouthStack - Offline Coding LLM System
 * Main Application Logic
 * Uses WebLLM from MLC AI
 */

const CONFIG = {
    // Use WebLLM prebuilt model IDs (must match prebuiltAppConfig.model_list)
    primaryModel: 'Llama-3.2-1B-Instruct-q4f16_1-MLC',
    fallbackModel: 'SmolLM2-360M-Instruct-q4f16_1-MLC',
    maxTokens: 512,
    temperature: 0.2,
    minRAMGB: 6,
    webllmCDN: 'https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.80/lib/index.js'
};

let webllm = null;
let currentModel = null;
let isModelLoaded = false;
let engine = null;

function printBanner() {
    console.log('============================================================');
    console.log('  SouthStack v1.0 - Offline Coding LLM');
    console.log('============================================================');
    console.log('  Model: ' + (currentModel || 'Not loaded'));
    console.log('  WebGPU: ' + (navigator.gpu ? 'Available' : 'Unavailable'));
    console.log('  Offline: ' + (navigator.onLine ? 'Online' : 'Offline Mode'));
    console.log('  Cache: ' + (isModelLoaded ? 'Ready' : 'Not Ready'));
    console.log('============================================================');
}

async function checkWebGPUSupport() {
    if (!navigator.gpu) {
        console.warn('WebGPU is not available');
        updateUIStatus('webgpuStatus', 'Not Available', 'error');
        return false;
    }
    try {
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) {
            console.warn('WebGPU adapter not available');
            updateUIStatus('webgpuStatus', 'No Adapter', 'error');
            return false;
        }
        console.log('WebGPU is available');
        updateUIStatus('webgpuStatus', 'Available', 'success');
        return true;
    } catch (e) {
        console.error('WebGPU error:', e.message);
        updateUIStatus('webgpuStatus', 'Error', 'error');
        return false;
    }
}

async function checkRAM() {
    try {
        if (navigator.deviceMemory) {
            const ramGB = navigator.deviceMemory;
            const el = document.getElementById('memoryStatus');
            if (ramGB < CONFIG.minRAMGB) {
                console.warn('Low RAM: ' + ramGB + 'GB');
                el.textContent = ramGB + 'GB Low';
                el.className = 'status-value warning';
            } else {
                el.textContent = ramGB + 'GB OK';
            }
            return ramGB;
        }
        document.getElementById('memoryStatus').textContent = 'N/A';
    } catch (e) {
        document.getElementById('memoryStatus').textContent = 'N/A';
    }
    return null;
}

async function checkStorageQuota() {
    try {
        if (navigator.storage && navigator.storage.estimate) {
            const est = await navigator.storage.estimate();
            const availGB = ((est.quota - est.usage) / (1024*1024*1024)).toFixed(1);
            document.getElementById('storageStatus').textContent = availGB + 'GB free';
            return availGB;
        }
    } catch (e) {}
    document.getElementById('storageStatus').textContent = 'N/A';
    return null;
}

function updateUIStatus(id, text, type) {
    const el = document.getElementById(id);
    if (el) { el.textContent = text; el.className = 'status-value' + (type ? ' ' + type : ''); }
}

function updateProgress(pct) {
    const pb = document.getElementById('progressBar');
    const pp = document.getElementById('progressPercent');
    if (pb) pb.style.width = pct + '%';
    if (pp) pp.textContent = Math.round(pct) + '%';
}

function updateModelStatus(text, type) {
    updateUIStatus('modelStatus', text, type);
}

function showBanner(msg, type) {
    const b = document.getElementById('warningBanner');
    if (b) { b.innerHTML = '<span>' + msg + '</span>'; b.className = 'banner ' + type; }
}

async function loadWebLLM() {
    if (webllm) return webllm;
    console.log('Loading WebLLM...');
    try {
        // WebLLM is an ES module - must use dynamic import(), not script tag
        const module = await import(CONFIG.webllmCDN);
        webllm = module;
        console.log('WebLLM loaded');
        return webllm;
    } catch (e) {
        console.error('WebLLM load failed:', e);
        throw new Error('Failed to load WebLLM: ' + e.message);
    }
}

async function initializeEngine(modelName) {
    modelName = modelName || CONFIG.primaryModel;
    try {
        console.log('Initializing ' + modelName + '...');
        updateModelStatus('Loading ' + modelName + '...', 'warning');
        updateProgress(0);
        if (!webllm) {
            updateModelStatus('Downloading WebLLM...', 'warning');
            webllm = await loadWebLLM();
        }
        
        const cb = (r) => {
            if (!r) return;
            const pct = r.progress !== undefined ? r.progress * 100 : 0;
            if (r.text) console.log(r.text);
            if (pct > 0) console.log('Progress: ' + Math.round(pct) + '%');
            updateProgress(pct);
        };
        
        const CreateMLCEngine = webllm.CreateMLCEngine || webllm.default?.CreateMLCEngine;
        if (!CreateMLCEngine) throw new Error('CreateMLCEngine not found in WebLLM module');
        engine = await CreateMLCEngine(modelName, { initProgressCallback: cb });
        currentModel = modelName;
        isModelLoaded = true;
        console.log('Model loaded: ' + modelName);
        updateModelStatus(modelName, 'success');
        updateProgress(100);
        printBanner();
        showBanner(modelName + ' ready! Use ask() in console', 'success');
        window.dispatchEvent(new CustomEvent('southstack-model-ready'));
        return engine;
    } catch (e) {
        const msg = (e && e.message) || String(e);
        console.error('Init failed:', msg, e);
        updateModelStatus('Failed: ' + msg, 'error');
        if (msg.includes('memory') && modelName !== CONFIG.fallbackModel) {
            console.warn('Trying fallback model...');
            return initializeEngine(CONFIG.fallbackModel);
        }
        throw e;
    }
}

async function ensureInitialized() {
    if (engine && isModelLoaded) return engine;
    engine = await initializeEngine();
    return engine;
}

window.ask = async function(prompt) {
    console.log('\n=== Prompt ===');
    console.log(prompt);
    console.log('==============');
    try {
        const eng = await ensureInitialized();
        console.log('Generating...');
        let full = '';
        const stream = await eng.chat.completions.create({
            messages: [{role: 'user', content: prompt}],
            max_tokens: CONFIG.maxTokens,
            temperature: CONFIG.temperature,
            stream: true
        });
        for await (const chunk of stream) {
            const txt = chunk.choices[0]?.delta?.content || '';
            if (txt) {
                full += txt;
                if (typeof process !== 'undefined' && process.stdout && process.stdout.write) {
                    process.stdout.write(txt);
                } else {
                    console.log(txt);
                }
            }
        }
        console.log('\n=== Response ===');
        console.log(full);
        console.log('================');
        return full;
    } catch (e) {
        console.error('Error:', e);
        throw e;
    }
};

window.SouthStack = {
    checkWebGPUSupport, checkRAM, checkStorageQuota,
    ensureInitialized: () => ensureInitialized(),
    initializeEngine: (m) => initializeEngine(m),
    getModelInfo: () => ({ currentModel, isLoaded: isModelLoaded, config: CONFIG }),
    getSystemStatus: async () => ({
        webGPU: !!navigator.gpu,
        ramGB: await checkRAM(),
        storageGB: await checkStorageQuota(),
        online: navigator.onLine,
        modelLoaded: isModelLoaded,
        modelName: currentModel
    })
};

function detectBrowser() {
    const ua = navigator.userAgent;
    let b = 'Unknown';
    if (ua.includes('Chrome')) b = 'Chrome';
    else if (ua.includes('Firefox')) b = 'Firefox';
    else if (ua.includes('Safari')) b = 'Safari';
    document.getElementById('browserStatus').textContent = b;
}

async function init() {
    console.log('SouthStack initializing...');
    detectBrowser();
    const hasGPU = await checkWebGPUSupport();
    await checkRAM();
    await checkStorageQuota();
    if (!hasGPU) {
        showBanner('WebGPU not available. Enable in Chrome flags.', 'error');
        updateModelStatus('WebGPU Required', 'error');
        return;
    }
    try {
        updateModelStatus('Loading WebLLM...', 'warning');
        updateProgress(5);
        await ensureInitialized();
        console.log('Ready! Use ask("prompt")');
    } catch (e) {
        const msg = (e && e.message) || String(e);
        console.error('Init failed:', msg, e);
        updateModelStatus('Failed: ' + msg, 'error');
        updateProgress(0);
        showBanner('Init failed: ' + msg, 'error');
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    setTimeout(init, 100);
}
