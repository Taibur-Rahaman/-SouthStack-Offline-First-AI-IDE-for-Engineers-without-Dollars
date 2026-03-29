/**
 * SouthStack - Offline Coding LLM System
 * Main Application Logic
 * 
 * Uses WebLLM from MLC AI to run local LLM inference in browser via WebGPU
 */

// Configuration
const CONFIG = {
    primaryModel: 'Qwen1.5-1.8B-Chat-q4f16_1-MLC',
    fallbackModel: 'TinyLlama-1.1B-Chat-v0.4-q4f16_1-MLC',
    maxTokens: 512,
    temperature: 0.2,
    topP: 0.95,
    minRAMGB: 6,
    webllmCDN: 'https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.40/lib/index.js'
};

// Global State
let webllm = null;
let currentModel = null;
let isModelLoaded = false;
let isInitialized = false;
let engine = null;
let attemptedAutoRecovery = false;

function formatError(error) {
    if (!error) return 'Unknown error';
    if (typeof error === 'string') return error;
    if (error.message) return error.message;
    if (typeof DOMException !== 'undefined' && error instanceof DOMException) {
        return error.name ? (error.name + ': ' + (error.message || 'DOMException')) : 'DOMException';
    }
    try {
        return JSON.stringify(error);
    } catch {
        return String(error);
    }
}

async function clearRuntimeCaches() {
    try {
        if (typeof caches !== 'undefined' && caches.keys) {
            const names = await caches.keys();
            await Promise.all(names.map(name => caches.delete(name)));
        }
    } catch (e) {
        console.warn('Cache cleanup warning:', formatError(e));
    }
}

// Console Banner
function printBanner() {
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║                  SouthStack v1.0                            ║
║            Offline-First Coding LLM Runtime                  ║
╠══════════════════════════════════════════════════════════════╣
║  Model:        ${currentModel || 'Not loaded'}                     ║
║  WebGPU:       ${navigator.gpu ? 'Available' : 'Unavailable'}           ║
║  Offline:       ${navigator.onLine ? 'Online' : 'Offline Mode'}        ║
║  Cache:        ${isModelLoaded ? 'Ready' : 'Not Ready'}               ║
╚══════════════════════════════════════════════════════════════╝
    `);
}

// #region agent log
function dbgLogSs(hypothesisId, location, message, data) {
    const entry = {
        sessionId: '85d3ca',
        runId: 'adapter-debug',
        hypothesisId,
        location,
        message,
        data: data || {},
        timestamp: Date.now()
    };
    try {
        const a = (window.__southstackDbgLog = window.__southstackDbgLog || []);
        a.push(entry);
        if (a.length > 200) a.shift();
    } catch {}
    const payload = JSON.stringify(entry);
    try {
        console.info('[debug-85d3ca]', payload);
    } catch {}
    fetch('http://127.0.0.1:7895/ingest/561479c7-4a93-41fe-85d2-dcfdecab8321', {
        method: 'POST',
        mode: 'cors',
        headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '85d3ca' },
        body: payload
    }).catch(() => {});
}
// #endregion

let _ssGpuRequestAdapterWrapped = false;

// WebGPU Detection
function ensureWebGPUAdapterCompat() {
    try {
        dbgLogSs('H2', 'southstack/ensureWebGPU:entry', 'compat entry', {
            gpuAdapterType: typeof GPUAdapter,
            hasNavigatorGpu: !!navigator.gpu
        });

        if (typeof GPUAdapter !== 'undefined' && typeof GPUAdapter.prototype.requestAdapterInfo !== 'function') {
            GPUAdapter.prototype.requestAdapterInfo = async function requestAdapterInfoShim() {
                return this.info || {
                    vendor: 'unknown',
                    architecture: 'unknown',
                    device: 'unknown',
                    description: 'unknown'
                };
            };
        }

        if (navigator.gpu && navigator.gpu.__southstackGpuPatched) {
            _ssGpuRequestAdapterWrapped = true;
        }
        if (!_ssGpuRequestAdapterWrapped && navigator.gpu && typeof navigator.gpu.requestAdapter === 'function') {
            _ssGpuRequestAdapterWrapped = true;
            const orig = navigator.gpu.requestAdapter.bind(navigator.gpu);
            navigator.gpu.requestAdapter = async function ssPatchedRequestAdapter(options) {
                const adapter = await orig(options);
                const before = adapter ? typeof adapter.requestAdapterInfo : 'none';
                if (adapter && typeof adapter.requestAdapterInfo !== 'function') {
                    adapter.requestAdapterInfo = async function requestAdapterInfoInstance() {
                        return this.info || {
                            vendor: 'unknown',
                            architecture: 'unknown',
                            device: 'unknown',
                            description: 'unknown'
                        };
                    };
                }
                const after = adapter ? typeof adapter.requestAdapterInfo : 'none';
                dbgLogSs('H1', 'southstack/requestAdapter:wrap', 'adapter instance', {
                    before,
                    after,
                    hasAdapter: !!adapter
                });
                return adapter;
            };
        }

        dbgLogSs('H5', 'southstack/ensureWebGPU:exit', 'compat exit', {
            wrapped: _ssGpuRequestAdapterWrapped,
            protoRai:
                typeof GPUAdapter !== 'undefined' ? typeof GPUAdapter.prototype.requestAdapterInfo : 'no-GPUAdapter'
        });
    } catch (e) {
        dbgLogSs('H2', 'southstack/ensureWebGPU:catch', 'compat threw', { err: String(e?.message || e) });
    }
}

async function checkWebGPUSupport() {
    if (!navigator.gpu) {
        console.warn('WebGPU is not available in this browser');
        console.warn('Please enable WebGPU in Chrome flags: chrome://flags/#enable-unsafe-webgpu');
        updateUIStatus('webgpuStatus', 'Not Available', 'error');
        return false;
    }
    
    try {
        ensureWebGPUAdapterCompat();
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) {
            console.warn('WebGPU adapter not available');
            updateUIStatus('webgpuStatus', 'No Adapter', 'error');
            return false;
        }
        
        const info = adapter.info || { vendor: 'unknown', architecture: 'unknown' };
        console.log('WebGPU is available');
        console.log('GPU: ' + info.vendor + ' ' + info.architecture);
        updateUIStatus('webgpuStatus', 'Available', 'success');
        return true;
    } catch (error) {
        console.error('WebGPU error:', error.message);
        updateUIStatus('webgpuStatus', 'Error', 'error');
        return false;
    }
}

// RAM Check
async function checkRAM() {
    try {
        if (navigator.deviceMemory) {
            const ramGB = navigator.deviceMemory;
            const statusEl = document.getElementById('memoryStatus');
            
            if (ramGB < CONFIG.minRAMGB) {
                console.warn('Low RAM: ' + ramGB + 'GB (recommended: ' + CONFIG.minRAMGB + 'GB+)');
                statusEl.textContent = ramGB + 'GB Low';
                statusEl.className = 'status-value warning';
                showWarningBanner('Low RAM detected: ' + ramGB + 'GB. Consider closing other tabs.');
            } else {
                console.log('RAM: ' + ramGB + 'GB');
                statusEl.textContent = ramGB + 'GB OK';
                statusEl.className = 'status-value';
            }
            return ramGB;
        }
        
        if (performance.memory) {
            const usedMB = performance.memory.usedJSHeapSize / (1024 * 1024);
            const totalMB = performance.memory.totalJSHeapSize / (1024 * 1024);
            console.log('JS Heap: ' + Math.round(usedMB) + 'MB / ' + Math.round(totalMB) + 'MB');
            document.getElementById('memoryStatus').textContent = Math.round(totalMB) + 'MB';
            return totalMB / 1024;
        }
        
        document.getElementById('memoryStatus').textContent = 'Unknown';
        return null;
    } catch (e) {
        console.log('RAM check not available');
        document.getElementById('memoryStatus').textContent = 'N/A';
        return null;
    }
}

// Storage Quota Check
async function checkStorageQuota() {
    try {
        if (navigator.storage && navigator.storage.estimate) {
            const estimate = await navigator.storage.estimate();
            const usedGB = (estimate.usage / (1024 * 1024 * 1024)).toFixed(2);
            const quotaGB = (estimate.quota / (1024 * 1024 * 1024)).toFixed(2);
            const availableGB = (estimate.quota - estimate.usage) / (1024 * 1024 * 1024);
            
            console.log('Storage: ' + usedGB + 'GB / ' + quotaGB + 'GB (' + availableGB.toFixed(2) + 'GB available)');
            
            const statusEl = document.getElementById('storageStatus');
            statusEl.textContent = availableGB.toFixed(1) + 'GB free';
            
            if (availableGB < 1) {
                statusEl.className = 'status-value warning';
                showWarningBanner('Low storage: ' + availableGB.toFixed(1) + 'GB free. May need space for model.');
            } else {
                statusEl.className = 'status-value';
            }
            
            return availableGB;
        }
        
        document.getElementById('storageStatus').textContent = 'Unknown';
        return null;
    } catch (e) {
        console.log('Storage check not available');
        document.getElementById('storageStatus').textContent = 'N/A';
        return null;
    }
}

// UI Helpers
function updateUIStatus(elementId, text, type) {
    const el = document.getElementById(elementId);
    if (el) {
        el.textContent = text;
        el.className = 'status-value' + (type ? ' ' + type : '');
    }
}

function updateProgress(percent) {
    const progressBar = document.getElementById('progressBar');
    const progressPercent = document.getElementById('progressPercent');
    if (progressBar) progressBar.style.width = percent + '%';
    if (progressPercent) progressPercent.textContent = Math.round(percent) + '%';
}

function updateModelStatus(text, type) {
    updateUIStatus('modelStatus', text, type);
}

function showWarningBanner(message) {
    const banner = document.getElementById('warningBanner');
    if (banner) {
        banner.innerHTML = '<span class="banner-icon">!</span><span>' + message + '</span>';
        banner.className = 'banner warning';
    }
}

function showErrorBanner(message) {
    const banner = document.getElementById('errorBanner');
    if (banner) {
        banner.innerHTML = '<span class="banner-icon">X</span><span>' + message + '</span>';
        banner.className = 'banner error';
    }
}

function showSuccessBanner(message) {
    const banner = document.getElementById('warningBanner');
    if (banner) {
        banner.innerHTML = '<span class="banner-icon">OK</span><span>' + message + '</span>';
        banner.className = 'banner success';
    }
}

// Load WebLLM
async function loadWebLLM() {
    console.log('Loading WebLLM library...');
    try {
        ensureWebGPUAdapterCompat();
        const mod = await import(CONFIG.webllmCDN);
        console.log('WebLLM library loaded');
        if (mod && typeof mod.CreateMLCEngine === 'function') {
            return mod;
        }
        if (typeof self.mlc !== 'undefined' && self.mlc.llm && typeof self.mlc.llm.CreateMLCEngine === 'function') {
            return self.mlc.llm;
        }
        throw new Error('CreateMLCEngine not found after loading WebLLM');
    } catch (error) {
        console.error('Failed to load WebLLM:', error);
        throw new Error('Failed to load WebLLM from CDN');
    }
}

// Initialize Engine
async function initializeEngine(modelName) {
    modelName = modelName || CONFIG.primaryModel;
    
    try {
        console.log('Initializing ' + modelName + '...');
        updateModelStatus('Loading ' + modelName + '...');
        updateProgress(0);
        
        if (!webllm) {
            webllm = await loadWebLLM();
        }
        
        const initProgressCallback = (report) => {
            console.log('Loading progress: ' + Math.round(report.progress * 100) + '%');
            updateProgress(report.progress * 100);
            
            if (report.text) {
                console.log('  ' + report.text);
            }
        };
        
        const engineOptions = {
            initProgressCallback: initProgressCallback
        };
        if (webllm.prebuiltAppConfig) {
            engineOptions.appConfig = webllm.prebuiltAppConfig;
        }
        dbgLogSs('H3', 'southstack/initializeEngine:beforeCreate', 'before CreateMLCEngine', { modelName });
        const localEngine = await webllm.CreateMLCEngine(modelName, engineOptions);
        dbgLogSs('H7', 'southstack/initializeEngine:afterCreate', 'CreateMLCEngine ok', { modelName });

        currentModel = modelName;
        isModelLoaded = true;
        
        console.log('Model loaded successfully: ' + modelName);
        updateModelStatus(modelName, 'success');
        updateProgress(100);
        window.dispatchEvent(new Event('southstack-model-ready'));
        
        printBanner();
        
        showSuccessBanner(modelName + ' ready! Use ask("prompt") in console.');
        
        return localEngine;
        
    } catch (error) {
        console.error('Model initialization failed:', error);
        dbgLogSs('H4', 'southstack/initializeEngine:catch', 'CreateMLCEngine failed', {
            message: String(error?.message || error)
        });
        updateModelStatus('Load Failed', 'error');
        
        const errText = formatError(error);
        const msg = errText.toLowerCase();
        if (msg.includes('memory') || msg.includes('no url found for model id')) {
            console.warn('Memory error detected, attempting fallback model...');
            
            if (currentModel !== CONFIG.fallbackModel) {
                showWarningBanner('Primary model unavailable. Trying fallback model...');
                return initializeEngine(CONFIG.fallbackModel);
            }
        }
        if (!attemptedAutoRecovery && (msg.includes('domexception') || msg.includes('networkerror') || msg.includes('aborterror'))) {
            attemptedAutoRecovery = true;
            showWarningBanner('Transient browser cache/runtime issue detected. Auto-retrying once...');
            await clearRuntimeCaches();
            return initializeEngine(modelName);
        }
        
        throw new Error(errText);
    }
}

// Ensure Initialized
async function ensureInitialized() {
    if (engine && isModelLoaded) {
        return engine;
    }
    
    try {
        engine = await initializeEngine();
        isInitialized = true;
        return engine;
    } catch (error) {
        console.error('Initialization failed:', error);
        showErrorBanner('Failed to load model: ' + formatError(error));
        throw error;
    }
}

// Global ASK Function
window.ask = async function(prompt) {
    console.log('\n' + '='.repeat(60));
    console.log('Prompt:', prompt);
    console.log('='.repeat(60));
    
    try {
        const localEngine = await ensureInitialized();
        
        console.log('Generating response...');
        
        const chunks = [];
        let fullResponse = '';
        
        const output = await localEngine.chat.completions.create({
            messages: [{ role: 'user', content: prompt }],
            max_tokens: CONFIG.maxTokens,
            temperature: CONFIG.temperature,
            top_p: CONFIG.topP,
            stream: true
        });
        
        for await (const chunk of output) {
            const content = chunk.choices[0]?.delta?.content || '';
            if (content) {
                chunks.push(content);
                fullResponse += content;
                // Browser runtime has no process.stdout; stream to console/UI via accumulated text.
            }
        }
        
        console.log('\n');
        
        console.log('Response:');
        console.log('-'.repeat(40));
        console.log(fullResponse);
        console.log('-'.repeat(40));
        console.log('Response complete (' + fullResponse.length + ' characters)');
        
        return fullResponse;
        
    } catch (error) {
        console.error('Error during inference:', error);
        
        if (error.message && error.message.toLowerCase().includes('memory')) {
            console.warn('Memory error. Trying fallback model...');
            
            try {
                engine = await initializeEngine(CONFIG.fallbackModel);
                return window.ask(prompt);
            } catch (fallbackError) {
                console.error('Fallback also failed:', fallbackError);
            }
        }
        
        throw error;
    }
};

// SouthStack Namespace
window.SouthStack = {
    checkWebGPUSupport: checkWebGPUSupport,
    checkRAM: checkRAM,
    checkStorageQuota: checkStorageQuota,
    ensureInitialized: function() {
        return ensureInitialized();
    },
    initializeEngine: function(modelName) {
        return initializeEngine(modelName);
    },
    getModelInfo: function() {
        return {
            currentModel: currentModel,
            isLoaded: isModelLoaded,
            isInitialized: isInitialized,
            config: CONFIG
        };
    },
    getSystemStatus: async function() {
        const gpuAvailable = !!navigator.gpu;
        const ram = await checkRAM();
        const storage = await checkStorageQuota();
        
        return {
            webGPU: gpuAvailable,
            ramGB: ram,
            storageGB: storage,
            online: navigator.onLine,
            modelLoaded: isModelLoaded,
            modelName: currentModel
        };
    },
    reset: async function() {
        console.log('Resetting SouthStack...');
        engine = null;
        isModelLoaded = false;
        isInitialized = false;
        currentModel = null;
        window.location.reload();
    }
};

// Browser Detection
function detectBrowser() {
    const ua = navigator.userAgent;
    let browser = 'Unknown';
    
    if (ua.includes('Chrome')) {
        browser = 'Chrome';
    } else if (ua.includes('Firefox')) {
        browser = 'Firefox';
    } else if (ua.includes('Safari')) {
        browser = 'Safari';
    } else if (ua.includes('Edge')) {
        browser = 'Edge';
    }
    
    document.getElementById('browserStatus').textContent = browser;
    console.log('Browser: ' + browser);
}

// Initialization
async function initialize() {
    console.log('\n' + '='.repeat(60));
    console.log('SouthStack - Offline Coding LLM');
    console.log('='.repeat(60));
    
    detectBrowser();
    
    const gpuAvailable = await checkWebGPUSupport();
    
    await checkRAM();
    
    await checkStorageQuota();
    
    if (!gpuAvailable) {
        console.warn('\nWebGPU is not available!');
        console.warn('The model cannot run without WebGPU support.');
        console.warn('Please enable WebGPU in Chrome flags:');
        console.warn('  chrome://flags/#enable-unsafe-webgpu');
        console.warn('  Restart Chrome and try again\n');
        
        showErrorBanner('WebGPU not available. Please enable in Chrome flags.');
        updateModelStatus('WebGPU Required', 'error');
        return;
    }
    
    try {
        console.log('\nInitializing model (first load may take time)...');
        updateModelStatus('Downloading model...');
        
        await ensureInitialized();
        
        console.log('\nSouthStack is ready!');
        console.log('Use ask("your prompt") in the console to get started.\n');
        
    } catch (error) {
        console.error('\nFailed to initialize model:', error);
        showErrorBanner('Initialization failed: ' + formatError(error));
    }
}

ensureWebGPUAdapterCompat();

// Start initialization
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
} else {
    setTimeout(initialize, 100);
}


