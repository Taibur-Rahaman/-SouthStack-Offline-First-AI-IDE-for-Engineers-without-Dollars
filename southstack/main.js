/**
 * SouthStack - Offline Coding LLM System
 * Main Application Logic
 * Uses WebLLM from MLC AI
 */

import { P2PMesh } from "./p2p.js";
import { newTaskState, loadTask, saveTask, appendToken, checkpoint } from "./state.js";

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

// Fault-tolerant P2P demo state
const FT = {
    peerId: null,
    mesh: null,
    connected: false,
    remotePeerId: null,
    leaderId: null,
    lastHeartbeatByPeer: new Map(),
    currentTaskId: null,
    isGenerating: false,
    generationAbort: { aborted: false },
};

function randId(prefix) {
    const r = Math.random().toString(16).slice(2, 10);
    return `${prefix}_${r}`;
}

function setText(id, txt) {
    const el = document.getElementById(id);
    if (el) el.textContent = txt;
}

function isLeader() {
    return !!FT.peerId && FT.leaderId === FT.peerId;
}

function updateFTUI() {
    setText("peerIdStatus", FT.peerId || "—");
    setText("p2pStatus", FT.connected ? `Connected to ${FT.remotePeerId || "peer"}` : "Not connected");
    setText("leaderStatus", FT.leaderId ? (isLeader() ? `Leader (${FT.leaderId})` : `Follower (${FT.leaderId})`) : "—");
}

function electLeader() {
    // Deterministic: lowest lexical peerId among currently alive peers.
    const alive = new Set([FT.peerId]);
    for (const [pid, ts] of FT.lastHeartbeatByPeer.entries()) {
        if (Date.now() - ts < 3500) alive.add(pid);
    }
    const ids = Array.from(alive).filter(Boolean).sort();
    FT.leaderId = ids[0] || FT.peerId;
    updateFTUI();
}

function broadcast(msg) {
    if (!FT.mesh) return false;
    return FT.mesh.send(msg);
}

async function sendSnapshot(taskId) {
    const st = await loadTask(taskId);
    if (!st) return;
    broadcast({ type: "snapshot", taskId, state: st, from: FT.peerId, t: Date.now() });
}

async function applyIncomingSnapshot(state) {
    if (!state || !state.taskId) return;
    const local = await loadTask(state.taskId);
    // Last-write-wins by seq then updatedAt.
    if (!local || (state.seq || 0) > (local.seq || 0) || (state.updatedAt || 0) > (local.updatedAt || 0)) {
        await saveTask(state);
    }
}

async function handleFTMessage(msg) {
    if (!msg || !msg.type) return;
    if (msg.from) FT.lastHeartbeatByPeer.set(msg.from, Date.now());
    if (msg.type === "heartbeat") {
        // Heartbeats drive leader election.
        electLeader();
        return;
    }
    if (msg.type === "snapshot") {
        await applyIncomingSnapshot(msg.state);
        if (msg.state?.leaderId) FT.leaderId = msg.state.leaderId;
        if (msg.taskId) FT.currentTaskId = msg.taskId;
        updateFTUI();
        return;
    }
    if (msg.type === "token" && msg.taskId && typeof msg.token === "string") {
        await appendToken(msg.taskId, msg.token);
        FT.currentTaskId = msg.taskId;
        // Followers can update UI response box in near-real-time.
        const box = document.getElementById('responseBox');
        if (box && (!FT.isGenerating || !isLeader())) {
            const st = await loadTask(msg.taskId);
            if (st) {
                box.textContent = st.partialOutput || '';
                box.classList.remove('empty');
            }
        }
        return;
    }
    if (msg.type === "checkpoint" && msg.taskId) {
        const st = await loadTask(msg.taskId);
        if (!st) return;
        if (msg.leaderId !== undefined) st.leaderId = msg.leaderId;
        if (msg.status) st.status = msg.status;
        if (typeof msg.seq === "number") st.seq = Math.max(st.seq || 0, msg.seq);
        if (typeof msg.partialOutput === "string" && msg.partialOutput.length >= (st.partialOutput || "").length) {
            st.partialOutput = msg.partialOutput;
        }
        st.lastCheckpointAt = Date.now();
        await saveTask(st);
        FT.currentTaskId = msg.taskId;
        FT.leaderId = st.leaderId || FT.leaderId;
        updateFTUI();
        return;
    }
}

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

async function startFaultTolerantAsk(prompt) {
    // Create or load a task, then either generate (leader) or follow (follower).
    const taskId = FT.currentTaskId || randId("task");
    FT.currentTaskId = taskId;
    let st = await loadTask(taskId);
    if (!st) {
        st = newTaskState({ taskId, prompt, peerId: FT.leaderId || FT.peerId });
        st.leaderId = FT.leaderId || FT.peerId;
        await saveTask(st);
        await checkpoint(taskId, { leaderId: st.leaderId });
        broadcast({ type: "checkpoint", taskId, leaderId: st.leaderId, status: st.status, seq: st.seq, partialOutput: st.partialOutput, from: FT.peerId, t: Date.now() });
    }
    // Ensure followers know the snapshot quickly.
    await sendSnapshot(taskId);

    // If we are not leader, just return current partial output (it will update via replication).
    if (!isLeader()) {
        return (st.partialOutput || "");
    }
    // Leader generates (with periodic checkpoints + token broadcast).
    return await generateAsLeader(taskId);
}

async function generateAsLeader(taskId) {
    const st = await loadTask(taskId);
    if (!st) throw new Error("Task state missing");
    const eng = await ensureInitialized();
    FT.isGenerating = true;
    FT.generationAbort = { aborted: false };
    updateFTUI();

    const basePrompt = st.prompt || "";
    const partial = st.partialOutput || "";
    const continuationPrompt = partial ? `${basePrompt}\n\n(Continue exactly from this partial response, without repeating:)\n${partial}` : basePrompt;

    const box = document.getElementById('responseBox');
    if (box) {
        box.textContent = partial || '';
        box.classList.remove('empty');
        box.classList.add('streaming');
    }

    let lastCk = Date.now();
    try {
        // Announce leadership for this task.
        await checkpoint(taskId, { leaderId: FT.leaderId, status: "in_progress" });
        broadcast({ type: "checkpoint", taskId, leaderId: FT.leaderId, status: "in_progress", from: FT.peerId, t: Date.now() });

        const stream = await eng.chat.completions.create({
            messages: [{ role: 'user', content: continuationPrompt }],
            max_tokens: CONFIG.maxTokens,
            temperature: CONFIG.temperature,
            stream: true
        });
        for await (const chunk of stream) {
            if (FT.generationAbort.aborted) break;
            // If we lost leadership, stop and let new leader continue.
            if (!isLeader()) break;
            const txt = chunk.choices[0]?.delta?.content || '';
            if (!txt) continue;
            const next = await appendToken(taskId, txt);
            broadcast({ type: "token", taskId, token: txt, seq: next?.seq, from: FT.peerId, t: Date.now() });
            if (box) box.textContent = next?.partialOutput || '';

            if (Date.now() - lastCk > 1500) {
                lastCk = Date.now();
                const ck = await checkpoint(taskId, { leaderId: FT.leaderId, status: "in_progress" });
                broadcast({ type: "checkpoint", taskId, leaderId: ck?.leaderId, status: ck?.status, seq: ck?.seq, partialOutput: ck?.partialOutput, from: FT.peerId, t: Date.now() });
            }
        }
        // If we lost leadership mid-stream, leave task as in_progress so the new leader resumes.
        const finalStatus = isLeader() ? "done" : "in_progress";
        const done = await checkpoint(taskId, { leaderId: FT.leaderId, status: finalStatus });
        broadcast({ type: "checkpoint", taskId, leaderId: done?.leaderId, status: done?.status, seq: done?.seq, partialOutput: done?.partialOutput, from: FT.peerId, t: Date.now() });
        if (box) box.classList.remove('streaming');
        FT.isGenerating = false;
        return done?.partialOutput || "";
    } catch (e) {
        await checkpoint(taskId, { leaderId: FT.leaderId, status: "error" });
        broadcast({ type: "checkpoint", taskId, leaderId: FT.leaderId, status: "error", from: FT.peerId, t: Date.now() });
        if (box) box.classList.remove('streaming');
        FT.isGenerating = false;
        throw e;
    } finally {
        FT.isGenerating = false;
        updateFTUI();
    }
}

window.ask = async function(prompt) {
    console.log('\n=== Prompt ===');
    console.log(prompt);
    console.log('==============');
    try {
        // If P2P FT is active, route through it. Otherwise behave like the original single-node ask.
        if (FT.mesh) {
            return await startFaultTolerantAsk(prompt);
        }
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

function setupFaultTolerance() {
    // Stable-ish peerId for a tab session.
    FT.peerId = randId("peer");
    FT.leaderId = FT.peerId;

    FT.mesh = new P2PMesh({
        peerId: FT.peerId,
        onMessage: (msg) => handleFTMessage(msg),
        onPeerChange: (s) => {
            FT.connected = !!s.connected;
            FT.remotePeerId = s.remotePeerId || null;
            updateFTUI();
            // On connect, exchange snapshots.
            if (FT.connected && FT.currentTaskId) {
                sendSnapshot(FT.currentTaskId);
            }
        }
    });

    // Heartbeats.
    setInterval(() => {
        // Update our own liveness.
        FT.lastHeartbeatByPeer.set(FT.peerId, Date.now());
        broadcast({ type: "heartbeat", from: FT.peerId, leaderId: FT.leaderId, t: Date.now() });
        electLeader();

        // If we became leader while a task is in progress and we're not generating, try to resume.
        if (isLeader() && FT.currentTaskId && !FT.isGenerating) {
            loadTask(FT.currentTaskId).then((st) => {
                if (!st) return;
                if (st.status === "in_progress") {
                    generateAsLeader(FT.currentTaskId).catch(() => {});
                }
            }).catch(() => {});
        }
    }, 1200);

    updateFTUI();
}

// UI glue for the copy/paste signaling panel.
window.SouthStackFT_UI = {
    async createOffer() {
        try {
            const offer = await FT.mesh.createOffer();
            const out = document.getElementById("localSignal");
            if (out) out.value = JSON.stringify(offer);
        } catch (e) {
            console.error("Create offer failed:", e);
        }
    },
    async acceptOffer() {
        try {
            const inp = document.getElementById("remoteSignal");
            const obj = inp ? JSON.parse(inp.value || "{}") : null;
            await FT.mesh.setRemoteOffer(obj);
            const answer = await FT.mesh.createAnswer();
            const out = document.getElementById("localSignal");
            if (out) out.value = JSON.stringify(answer);
        } catch (e) {
            console.error("Accept offer failed:", e);
        }
    },
    async setAnswer() {
        try {
            const inp = document.getElementById("remoteSignal");
            const obj = inp ? JSON.parse(inp.value || "{}") : null;
            await FT.mesh.setRemoteAnswer(obj);
        } catch (e) {
            console.error("Set answer failed:", e);
        }
    },
    disconnect() {
        try {
            FT.mesh.disconnect();
        } catch {}
        updateFTUI();
    }
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
    setupFaultTolerance();
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
