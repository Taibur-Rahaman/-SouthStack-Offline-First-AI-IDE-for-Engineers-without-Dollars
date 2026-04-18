/**
 * SouthStack P2P — Fault-tolerant multi-agent coding
 * WebGPU LLM + WebRTC + shared state sync + checkpointing + leader election
 */

import { mergeLlmChatItems } from './p2p-state-merge.js';

/** WebRTC expects CRLF; browsers/textareas often use LF-only when pasting. */
function sdpToCrLf(s) {
  const normalized = (s || '').replace(/\r?\n/g, '\r\n').trim();
  return `${normalized}\r\n`;
}

function dbgLog(runId, hypothesisId, location, message, data = {}) {
  // #region agent log
  fetch('http://127.0.0.1:7895/ingest/561479c7-4a93-41fe-85d2-dcfdecab8321',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'947c6e'},body:JSON.stringify({sessionId:'947c6e',runId,hypothesisId,location,message,data,timestamp:Date.now()})}).catch(()=>{});
  // #endregion
}

let _p2pGpuRequestAdapterWrapped = false;

/**
 * Some Chromium builds expose adapter.info but not adapter.requestAdapterInfo().
 * WebLLM calls it on the adapter instance; patch prototype AND wrap requestAdapter.
 */
function ensureWebGPUAdapterCompat() {
  try {
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
      _p2pGpuRequestAdapterWrapped = true;
    }
    if (!_p2pGpuRequestAdapterWrapped && navigator.gpu && typeof navigator.gpu.requestAdapter === 'function') {
      _p2pGpuRequestAdapterWrapped = true;
      const orig = navigator.gpu.requestAdapter.bind(navigator.gpu);
      navigator.gpu.requestAdapter = async function p2pPatchedRequestAdapter(options) {
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
        return adapter;
      };
    }

  } catch (e) {
    console.warn('[SouthStack P2P] WebGPU adapter compat:', e);
  }
}

// #region agent log
function dbgLogP2p(hypothesisId, location, message, data) {
  const entry = {
    sessionId: '85d3ca',
    runId: 'p2p-adapter-debug',
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

const OFFLINE_LAN =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('offline') === '1';
const FAST_MODEL_ONLY =
  typeof window !== 'undefined' &&
  ['1', 'true', 'yes'].includes(
    (new URLSearchParams(window.location.search).get('lite') ||
      new URLSearchParams(window.location.search).get('fast') ||
      '')
      .toLowerCase()
      .trim()
  );

const LAN_BASE_STORAGE_KEY = 'southstack-p2p-lan-base';
const CODING_ASSISTANT_SYSTEM_PROMPT =
  'You are SouthStack, a programming and computer-science assistant. Only answer software and coding questions. ' +
  'If a prompt is outside programming, briefly refuse and ask for a coding question. ' +
  'Be factual and concise. Do not invent facts or biographies. ' +
  'For code requests, provide a short correct example and explain in 1-3 bullets.';
const NON_CODING_REPLY =
  'I can help with programming and computer science only. Please ask a coding question (for example: "What is an array in C?" or "Write a Python loop example").';

const CONFIG = {
  /** Smallest model first so first-time download finishes sooner; larger coder models tried after. */
  modelCandidates: FAST_MODEL_ONLY
    ? ['TinyLlama-1.1B-Chat-v0.4-q4f16_1-MLC']
    : [
        'TinyLlama-1.1B-Chat-v0.4-q4f16_1-MLC',
        'Qwen1.5-1.8B-Chat-q4f16_1-MLC',
        'Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC'
      ],
  /** Abort load if stuck (slow network / GPU). */
  modelLoadTimeoutMs: 20 * 60 * 1000,
  /** Empty = no STUN (works on same LAN / same machine after models are cached). Add ?offline=1 to force. */
  stun: OFFLINE_LAN ? [] : ['stun:stun.l.google.com:19302'],
  syncIntervalMs: 2500,
  /** Phones / Wi‑Fi often need >5s to gather host/srflx candidates; short timeout → incomplete SDP → no data channel → “stuck alone”. */
  iceGatherTimeoutMs: 15000,
  dbName: 'southstack-p2p',
  dbStore: 'checkpoints',
  /** Legacy `ask()` / southstack & southstack-demo console API (user-only message, no coding filter). */
  legacyMaxTokens: 512,
  legacyTemperature: 0.2,
  legacyTopP: 0.95,
  /** Warn in diagnostics when device RAM is below this (GB). */
  minRAMGB: 6
};

function rtcIceServers() {
  const servers = CONFIG.stun.map(u => ({ urls: u }));
  try {
    // Optional TURN fallback for NAT traversal.
    // Set in DevTools before starting: window.SOUTHSTACK_TURN = { urls, username, credential }
    const turn = typeof window !== 'undefined' ? window.SOUTHSTACK_TURN : null;
    if (turn && turn.urls) servers.push(turn);
  } catch {
    /* ignore */
  }
  return servers;
}

/** @type {import('@mlc-ai/web-llm').MLCEngine} */
let engine = null;
let modelLoaded = false;
/** Last WebLLM model id that successfully loaded (for SouthStack.getSystemStatus). */
let lastLoadedModelId = null;
/** Serializes concurrent initEngine() (page init + Ask button). */
let engineInitInFlight = null;
/** When `'ask'`, WebLLM init progress updates #askLlmLoadBanner. */
let engineInitUiTarget = null;
const WEBGPU_UNAVAILABLE_MESSAGE =
  'This browser does not expose WebGPU. Local AI cannot run on this device, but you can still join as a guest and use Ask through a linked coordinator device.';

function isWebGpuUnsupportedError(err) {
  const msg = String(err?.message || err || '');
  return msg.includes('does not expose WebGPU');
}
function newLocalPeerId() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    /* ignore */
  }
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 14)}`;
}

function newSessionAuthToken() {
  const rand = Math.random().toString(36).slice(2, 12);
  return `atk_${Date.now().toString(36)}_${rand}`;
}

function splitLargeContextText(text, chunkChars = 6000) {
  const src = String(text || '').trim();
  if (!src) return [];
  if (src.length <= chunkChars) return [src];
  const chunks = [];
  for (let i = 0; i < src.length; i += chunkChars) {
    chunks.push(src.slice(i, i + chunkChars));
  }
  return chunks;
}

function splitContextByModuleAffinity(text, chunkChars = 6000) {
  const src = String(text || '').trim();
  if (!src) return [];
  const lines = src.split('\n');
  const moduleHeaderRe =
    /^`?([A-Za-z0-9_./-]+\.(?:js|mjs|cjs|ts|tsx|jsx|py|java|go|rs|cpp|cc|c|h|hpp|md|json|ya?ml|toml|html|css|scss|sh))`?\s*[:|-]?/i;
  const groups = [];
  let current = { module: 'general', lines: [] };

  for (const line of lines) {
    const trimmed = line.trim();
    const hit = trimmed.match(moduleHeaderRe);
    if (hit && current.lines.length > 0) {
      groups.push(current);
      current = { module: hit[1], lines: [line] };
      continue;
    }
    if (hit && current.lines.length === 0) {
      current.module = hit[1];
      current.lines.push(line);
      continue;
    }
    current.lines.push(line);
  }
  if (current.lines.length > 0) groups.push(current);

  const out = [];
  for (const g of groups) {
    const block = g.lines.join('\n').trim();
    if (!block) continue;
    if (block.length <= chunkChars) {
      out.push({ module: g.module, text: block });
      continue;
    }
    for (let i = 0; i < block.length; i += chunkChars) {
      out.push({
        module: g.module,
        text: block.slice(i, i + chunkChars)
      });
    }
  }
  return out;
}

function buildContextRoutedSubtasks(task) {
  const moduleChunks = splitContextByModuleAffinity(task, 6000);
  const chunks =
    moduleChunks.length > 0
      ? moduleChunks
      : splitLargeContextText(task, 6000).map(text => ({ module: 'general', text }));
  return chunks.map((chunk, i) => ({
    id: i,
    text:
      `Context shard ${i + 1}/${chunks.length} [module: ${chunk.module}]: analyze this code/context shard and extract relevant implementation notes, risks, and edits.\n\n` +
      chunk.text,
    assignedTo: null,
    status: 'pending'
  }));
}

function compactStateForWire(raw) {
  const state = structuredClone(raw);
  // Relaxed caps: large shared chat / plan streams must survive real LAN sync (DC ~16MB budget).
  const maxPartial = 120000;
  const maxChatItems = 500;
  if (state?.generation?.partialOutput && state.generation.partialOutput.length > maxPartial) {
    state.generation.partialOutput = state.generation.partialOutput.slice(-maxPartial);
  }
  if (Array.isArray(state?.llmChat?.items) && state.llmChat.items.length > maxChatItems) {
    state.llmChat.items = state.llmChat.items.slice(-maxChatItems);
  }
  if (typeof state?.llmChat?.streamPartial === 'string' && state.llmChat.streamPartial.length > maxPartial) {
    state.llmChat.streamPartial = state.llmChat.streamPartial.slice(-maxPartial);
  }
  return state;
}
let localPeerId = newLocalPeerId();
if (typeof window !== 'undefined' && typeof window.DEBUG_P2P !== 'boolean') {
  window.DEBUG_P2P = false;
}
let localConnection = null;
/** @type {Map<string, RTCDataChannel>} peerId -> channel (remote peers) */
const channelsByPeer = new Map();
/** @type {Map<string, RTCPeerConnection>} peerId -> peer connection */
const peerConnectionsByPeer = new Map();
/** @type {Map<string, { taskId: string, subtaskId: number, attempt: number, assignee: string, startedAt: number, timer: number | null, acked: boolean }>} */
const pendingTaskAcks = new Map();
/** @type {Set<string>} track processed task messages (idempotency) */
const seenTaskMessageIds = new Set();
/** @type {Map<number, string>} local cache for duplicate subtask retries */
const completedSubtaskCache = new Map();
/** Stable idempotency key per task execution: `${taskId}:${subtaskId}` */
const executedTasks = new Set();
/** @type {Map<string, number>} peerId -> ping sent timestamp */
const pendingTransportPings = new Map();
/** @type {Map<string, { rttMs: number, inflight: number, done: number, fail: number, lastSeenAt: number, webgpu: boolean }>} */
const peerStats = new Map();
/** @type {RTCPeerConnection | null} */
let pendingLeaderConnection = null;
/** Coordinator election state */
let currentCoordinator = null; // peerId of current coordinator
let coordinatorCandidates = []; // list of peers with WebGPU capable of being coordinator
let localHasWebGPU = false; // whether THIS device has WebGPU
let isLocalCoordinator = false; // true if this device is currently the coordinator
let syncTimer = null;
let signalBus = null;
let latestOfferSdp = '';
let hostAnswerPollTimer = null;
/** peer key -> candidate polling timer */
const candidatePollers = new Map();
let joinRoomInProgress = false;
let lastTransportHeartbeatAt = 0;
/** Cleared when P2P hello / data channel proves we are not isolated. */
let p2pLinkWatchdogTimer = null;
/** Guest: last Ask request id (for coordinator reject messages). */
let pendingLlmAskRequestId = null;
/** Leader: serializes shared “Ask” jobs (FIFO across devices). */
let leaderLlmTail = Promise.resolve();
/** Guest: prompt sent to coordinator, shown until shared state includes the turn. */
let pendingGuestPrompt = null;
/** Current Ask stream stop hook (leader/solo). */
let activeSharedAskStop = null;
/** Auto-reconnect timer when link drops. */
let reconnectTimer = null;
let reconnectAttempt = 0;
/** After any link loss, next open channel pushes a full state snapshot once (star topology convergence). */
let p2pNeedsFullResync = false;
let sessionAuthToken = '';
/** Last time this peer saw a valid host heartbeat (clients only). */
let lastHostHeartbeatAt = 0;
/** @type {ReturnType<typeof setInterval> | null} */
let hostHeartbeatTimer = null;
/** @type {ReturnType<typeof setInterval> | null} */
let clientHostWatchdogTimer = null;
let hostFailoverCooldownUntil = 0;
let lastLoggedRole = '';
let lastElectedHostId = '';
let lastHeartbeatPublicLogAt = 0;
/** @type {Map<string, boolean>} */
const authenticatedPeers = new Map();

/** Last assistant bubble id we already spoke (avoid repeats / history on load). */
let voiceLastSpokenMsgId = '';
/** @type {SpeechRecognition | null} */
let voiceRecognition = null;
let voiceListening = false;
/** @type {HTMLTextAreaElement | HTMLInputElement | null} */
let voiceBoundField = null;
let voiceFinalTranscript = '';
/** True when the user tapped the mic to stop (so auto-send Ask only then, not on browser onend quirks). */
let voiceUserRequestedStop = false;
/** User is in a voice-dictation session (survives Chrome’s short recognition segments until they tap stop). */
let voiceSessionActive = false;
/** Bumps when a new mic session starts so stale `onend` handlers no-op. */
let voiceTurnGeneration = 0;
/** Prevents overlapping async mic starts (double-clicks). */
let voiceStartInProgress = false;
/** Last voice pipeline error for SouthStack.getVoiceSupport(). */
let voiceLastError = '';

const SESSION_KEY = 'southstack-p2p-last-session';
const VOICE_KEY_SPEAK = 'southstack-p2p-voice-speak';
const VOICE_KEY_AUTOSEND = 'southstack-p2p-voice-autosend';
const TASK_RETRY_MAX = 3;
const TASK_ACK_TIMEOUT_MS = 3500;
const RECONNECT_BACKOFF_MS = [1500, 3000, 5000, 8000, 13000];
const RECONNECT_MAX_ATTEMPTS = 20;
const TRANSPORT_HEARTBEAT_MS = 4000;
const TRANSPORT_STALE_MS = 16000;
/** Host coordination: application-level liveness (separate from transport ping). */
const HOST_HEARTBEAT_INTERVAL_MS = 2000;
const HOST_HEARTBEAT_MISS_MS = 5000;
const HOST_FAILOVER_COOLDOWN_MS = 4000;
const LOCAL_CONTEXT_MAX_CHARS = 18000;
const METRICS_DB_KEY = 'southstack-p2p-metrics-latest';

function dbgP2P(...args) {
  if (typeof window !== 'undefined' && window.DEBUG_P2P) {
    console.debug('[P2P DEBUG]', ...args);
  }
}

let metricsState = {
  taskId: null,
  startedAt: 0,
  finishedAt: 0,
  responseTimeMs: 0,
  retries: 0,
  failures: 0,
  transportDrops: 0,
  subtaskCount: 0,
  peerUtilization: {}, // peerId -> { assigned, completed, failed }
  outputQualityNotes: []
};

function clearSharedAskBusyState() {
  sharedState.llmChat.busy = false;
  sharedState.llmChat.streamPartial = '';
  sharedState.llmChat.runPeerId = null;
}

function recoverSharedAskAsStopped(byPeerId = null) {
  const chat = sharedState.llmChat;
  if (!chat || !chat.busy) return false;
  const partial = typeof chat.streamPartial === 'string' ? chat.streamPartial.trim() : '';
  const by = byPeerId ? ` by device ${String(byPeerId).slice(0, 8)}…` : '';
  const stoppedLine = `[Stopped${by}]`;
  chat.items.push({
    id: `m_${Date.now()}_${Math.random().toString(36).slice(2, 9)}_stop`,
    role: 'assistant',
    fromPeerId: localPeerId,
    content: partial ? `${partial}\n\n${stoppedLine}` : stoppedLine,
    at: Date.now()
  });
  clearSharedAskBusyState();
  return true;
}

function clearP2PLinkWatchdog() {
  if (p2pLinkWatchdogTimer) {
    clearTimeout(p2pLinkWatchdogTimer);
    p2pLinkWatchdogTimer = null;
  }
}

function scheduleGuestLinkWatchdog() {
  clearP2PLinkWatchdog();
  p2pLinkWatchdogTimer = setTimeout(() => {
    p2pLinkWatchdogTimer = null;
    if (channelsByPeer.size < 1) {
      log('Watchdog: no peer data channel — check Wi‑Fi, ?offline=1 on both, firewall.');
      setRoomStatus(
        '<strong>Still not sharing with the host.</strong> “Devices” may show only this device. Fix: same Wi‑Fi as PC; add <code>?offline=1</code> to the URL on <strong>host and phone</strong>; reload; tap <strong>Join room</strong> again. Or ask the host to click <strong>New guest</strong> and resend the invite.'
      );
    }
  }, 42000);
}

/** Leader: unblock sequential delegateSubtasksFromState when a subtask finishes. */
const subtaskDoneWaiters = new Map();

function notifySubtaskDone(subtaskId) {
  const fn = subtaskDoneWaiters.get(subtaskId);
  if (fn) {
    subtaskDoneWaiters.delete(subtaskId);
    fn();
  }
}

function waitForSubtaskDone(subtaskId, ms) {
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      if (subtaskDoneWaiters.has(subtaskId)) {
        subtaskDoneWaiters.delete(subtaskId);
        log(`Subtask ${subtaskId} timed out waiting for result (${Math.round(ms / 1000)}s).`);
      }
      resolve();
    }, ms);
    subtaskDoneWaiters.set(subtaskId, () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function makeTaskMessageId(subtaskId, assignee, attempt) {
  return `task_${sharedState.taskId || 'na'}_${subtaskId}_${assignee}`;
}

function hashTaskKey(text = '', type = 'execute') {
  const src = `${type}:${String(text)}`;
  let h = 2166136261;
  for (let i = 0; i < src.length; i += 1) {
    h ^= src.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `tsk_${(h >>> 0).toString(16)}`;
}

function inferTaskType(subtaskText = '') {
  const t = String(subtaskText || '').toLowerCase();
  if (t.includes('[analyzer]')) return 'analyze';
  if (t.includes('[fixer]')) return 'fix';
  return 'execute';
}

function waitForTaskAck(messageId, timeoutMs) {
  return new Promise(resolve => {
    const pending = pendingTaskAcks.get(messageId);
    if (!pending) {
      resolve(false);
      return;
    }
    pending.timer = setTimeout(() => {
      const nowPending = pendingTaskAcks.get(messageId);
      if (!nowPending) {
        resolve(false);
        return;
      }
      if (nowPending.acked) {
        pendingTaskAcks.delete(messageId);
        resolve(true);
        return;
      }
      pendingTaskAcks.delete(messageId);
      resolve(false);
    }, timeoutMs);
  });
}

async function sendSubtaskWithRetry(st, assignee) {
  ensurePeerMetric(assignee);
  metricsState.peerUtilization[assignee].assigned += 1;
  const ch = channelsByPeer.get(assignee);
  if (!ch || ch.readyState !== 'open') {
    metricsState.failures += 1;
    metricsState.peerUtilization[assignee].failed += 1;
    touchPeerStat(assignee, { fail: (peerStats.get(assignee)?.fail || 0) + 1 });
    return false;
  }
  const taskType = inferTaskType(st.text);
  const stableTaskId = hashTaskKey(st.text, taskType);
  for (let attempt = 1; attempt <= TASK_RETRY_MAX; attempt += 1) {
    const messageId = makeTaskMessageId(st.id, assignee, attempt);
    const startedAt = Date.now();
    pendingTaskAcks.set(messageId, {
      taskId: sharedState.taskId || 'na',
      subtaskId: st.id,
      attempt,
      assignee,
      startedAt,
      timer: null,
      acked: false
    });
    touchPeerStat(assignee, { inflight: (peerStats.get(assignee)?.inflight || 0) + 1 });
    const sent = sendOnChannel(ch, {
      id: messageId,
      type: 'subtask',
      taskId: sharedState.taskId || 'na',
      subtaskId: st.id,
      taskType,
      stableTaskId,
      payload: st.text,
      messageId,
      attempt
    }, assignee);
    if (!sent) {
      pendingTaskAcks.delete(messageId);
      touchPeerStat(assignee, { inflight: Math.max(0, (peerStats.get(assignee)?.inflight || 1) - 1) });
      return false;
    }
    const acked = await waitForTaskAck(messageId, TASK_ACK_TIMEOUT_MS * attempt);
    if (acked) {
      const rtt = Date.now() - startedAt;
      const prev = peerStats.get(assignee)?.rttMs || TASK_ACK_TIMEOUT_MS;
      touchPeerStat(assignee, {
        rttMs: Math.round((prev * 0.7) + (rtt * 0.3)),
        inflight: Math.max(0, (peerStats.get(assignee)?.inflight || 1) - 1)
      });
      return true;
    }
    metricsState.retries += 1;
    touchPeerStat(assignee, {
      fail: (peerStats.get(assignee)?.fail || 0) + 1,
      inflight: Math.max(0, (peerStats.get(assignee)?.inflight || 1) - 1)
    });
    log(`Retrying subtask ${st.id} on device ${assignee.slice(0, 8)}… (${attempt}/${TASK_RETRY_MAX})`);
  }
  metricsState.failures += 1;
  metricsState.peerUtilization[assignee].failed += 1;
  return false;
}
/** @type {boolean | null} */

/** peerId → WebGPU available (from hello); coordinator prefers lowest id among true. */
const peerWebGpuByPeer = new Map();

/** Best-effort local WebGPU; set before first P2P hello. */
let localWebGpuLikely = false;

const P2PAgents = {
  roomId: null,
  isLeader: false,
  leaderId: null,
  /** Coordinator role: host = elected leader (lowest peerId), client = everyone else. */
  role: /** @type {'host' | 'client'} */ ('host'),
  /** @type {Set<string>} */
  knownPeerIds: new Set([localPeerId]),
  taskQueue: [],
  results: []
};

async function detectLocalWebGpuLikely() {
  try {
    if (typeof navigator === 'undefined' || !navigator.gpu) {
      localHasWebGPU = false;
      return false;
    }
    const adapter = await navigator.gpu.requestAdapter();
    localHasWebGPU = !!adapter;
    return localHasWebGPU;
  } catch {
    localHasWebGPU = false;
    return false;
  }
}

// ---------- Coordinator Election & Failover ----------
/**
 * Elect a new coordinator from available peers with WebGPU.
 * Election rules:
 * 1. Only peers with WebGPU can be coordinator
 * 2. Prefer peer with lowest peerId (deterministic)
 * 3. If no peer has WebGPU, system waits until one joins
 * 4. Automatic failover when coordinator disconnects
 */
async function electNewCoordinator() {
  log('🗳️ Starting coordinator election...');
  
  // Build list of coordinator-capable peers
  coordinatorCandidates = [];
  
  // Add local peer if it has WebGPU
  if (localHasWebGPU) {
    coordinatorCandidates.push({
      peerId: localPeerId,
      isLocal: true,
      webgpu: true
    });
  }
  
  // Add remote peers with WebGPU capability
  peerStats.forEach((stats, peerId) => {
    if (stats.webgpu && channelsByPeer.has(peerId)) {
      coordinatorCandidates.push({
        peerId,
        isLocal: false,
        webgpu: true
      });
    }
  });
  
  if (coordinatorCandidates.length === 0) {
    log('⚠️ No WebGPU-capable devices in room. Waiting for capable device to join...');
    currentCoordinator = null;
    isLocalCoordinator = false;
    updateCoordinatorUI();
    return null;
  }
  
  // Sort by peerId (deterministic - lowest ID wins)
  coordinatorCandidates.sort((a, b) => a.peerId.localeCompare(b.peerId));
  
  // Elect winner
  const winner = coordinatorCandidates[0];
  currentCoordinator = winner.peerId;
  isLocalCoordinator = winner.isLocal;
  
  log(`✅ Elected new coordinator: ${winner.peerId.slice(0, 8)}... (${winner.isLocal ? 'this device' : 'remote device'})`);
  
  // Broadcast election result to all peers
  broadcastCoordinatorInfo();
  
  // Update UI
  updateCoordinatorUI();
  
  // If this device became coordinator, initialize engine
  if (isLocalCoordinator && !engine) {
    log('🤖 This device is now coordinator - initializing WebGPU LLM...');
    try {
      await initEngine();
      log('✅ Coordinator LLM ready');
    } catch (err) {
      log('❌ Coordinator failed to initialize LLM:', err);
      // Trigger re-election if this device can't run
      await electNewCoordinator();
    }
  }
  
  return currentCoordinator;
}

/** Broadcast coordinator election result to all connected peers */
function broadcastCoordinatorInfo() {
  const message = {
    type: 'coordinator_elected',
    coordinatorPeerId: currentCoordinator,
    timestamp: Date.now(),
    candidates: coordinatorCandidates.map(c => ({
      peerId: c.peerId,
      hasWebGPU: c.webgpu
    }))
  };
  
  // Send to all connected peers
  channelsByPeer.forEach((channel, peerId) => {
    if (channel.readyState === 'open') {
      sendOnChannel(channel, message, peerId);
    }
  });
  
  // Also update shared state
  sharedState.coordinator = currentCoordinator;
  broadcastState();
}

/** Handle incoming coordinator election message */
function handleCoordinatorElection(data) {
  const { coordinatorPeerId, candidates } = data;
  
  if (!coordinatorPeerId) {
    log('⚠️ Received invalid coordinator election message');
    return;
  }
  
  currentCoordinator = coordinatorPeerId;
  isLocalCoordinator = (currentCoordinator === localPeerId);
  
  log(`📢 Coordinator updated: ${coordinatorPeerId.slice(0, 8)}... (${isLocalCoordinator ? 'this device' : 'remote device'})`);
  
  updateCoordinatorUI();
  
  // If this device should be coordinator but isn't initialized yet
  if (isLocalCoordinator && !engine) {
    log('🤖 Becoming coordinator - initializing LLM...');
    initEngine().catch(err => {
      log('❌ Failed to initialize as coordinator:', err);
      // Clear coordinator status and trigger re-election
      currentCoordinator = null;
      isLocalCoordinator = false;
      setTimeout(() => electNewCoordinator(), 2000);
    });
  }
}

/** Update UI to show coordinator status */
function updateCoordinatorUI() {
  const coordinatorBanner = document.getElementById('coordinatorBanner');
  const askButton = document.getElementById('startSharedJobBtn');
  
  if (!currentCoordinator) {
    if (coordinatorBanner) {
      coordinatorBanner.innerHTML = `
        <div style="padding:12px;background:rgba(255,159,10,0.2);border:2px solid #ff9f0a;border-radius:8px;margin:10px 0;">
          <strong>⏳ Waiting for WebGPU device...</strong><br>
          <small>No device with WebGPU is currently connected. Connect another device or enable WebGPU on this device.</small>
        </div>`;
      coordinatorBanner.style.display = 'block';
    }
    if (askButton) askButton.disabled = true;
  } else {
    const coordShort = currentCoordinator.slice(0, 8);
    const isRemote = !isLocalCoordinator;
    
    if (coordinatorBanner) {
      const icon = isRemote ? '📱' : '💻';
      const status = isRemote ? 'connected to' : 'running on';
      coordinatorBanner.innerHTML = `
        <div style="padding:12px;background:rgba(0,168,132,0.2);border:2px solid #00a884;border-radius:8px;margin:10px 0;">
          <strong>${icon} AI Coordinator: ${status} device ${coordShort}...</strong><br>
          <small>${isRemote ? 'Your prompts will be sent to this device for processing.' : 'You are running the AI for all connected devices.'}</small>
        </div>`;
      coordinatorBanner.style.display = 'block';
    }
    if (askButton) askButton.disabled = false;
  }
  
  // Update peer list to show coordinator marker
  updatePeers();
}

/** Align coordinator banner / host state with deterministic host election (lowest peerId). */
function checkCoordinatorNeeded() {
  applyLeader();
}

/** Enhanced peer connection handler that triggers coordinator election */
const originalAddPeer = window.addPeer || function(peerId, connection) {};
window.addPeer = function(peerId, connection) {
  originalAddPeer(peerId, connection);
  
  // After adding peer, check if coordinator election is needed
  setTimeout(() => {
    checkCoordinatorNeeded();
  }, 1000);
};

/** Distributed task + generation state (CRDT-friendly: version bumps on writer) */
let sharedState = {
  version: 0,
  taskId: null,
  status: 'idle', // idle | planning | running | merging | done | error
  originalPrompt: '',
  /** Stored so failover can replay the same planning instruction */
  planPrompt: '',
  subtasks: [], // { id, text, assignedTo, status: pending|running|done|failed, result? }
  generation: {
    phase: 'idle', // idle | plan_stream | main_stream | subtask_N
    partialOutput: '',
    streaming: false,
    lastChunkAt: 0
  },
  /** WhatsApp-style shared thread when devices are linked; coordinator (leader) runs the model. */
  llmChat: {
    busy: false,
    runPeerId: null,
    streamPartial: '',
    items: [] // { id, role: 'user'|'assistant', fromPeerId, content, at }
  }
};

// ---------- IndexedDB checkpoints ----------
function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(CONFIG.dbName, 1);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(CONFIG.dbStore)) {
        db.createObjectStore(CONFIG.dbStore, { keyPath: 'taskId' });
      }
    };
  });
}

async function saveCheckpoint() {
  try {
    const db = await openDb();
    const tx = db.transaction(CONFIG.dbStore, 'readwrite');
    const rec = {
      taskId: sharedState.taskId || 'default',
      state: structuredClone(sharedState),
      savedAt: Date.now()
    };
    tx.objectStore(CONFIG.dbStore).put(rec);
    return new Promise((res, rej) => {
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  } catch (e) {
    console.warn('checkpoint save failed', e);
  }
}

async function loadCheckpoint(taskId) {
  try {
    const db = await openDb();
    const tx = db.transaction(CONFIG.dbStore, 'readonly');
    const req = tx.objectStore(CONFIG.dbStore).get(taskId || 'default');
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result?.state || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

async function restoreCheckpointIfAny(taskId = null) {
  const restored = await loadCheckpoint(taskId || 'default');
  if (!restored || typeof restored !== 'object') return false;
  sharedState = {
    ...sharedState,
    ...restored,
    subtasks: Array.isArray(restored.subtasks) ? restored.subtasks.map(s => ({ ...s })) : [],
    generation: restored.generation ? { ...sharedState.generation, ...restored.generation } : sharedState.generation,
    llmChat: restored.llmChat ? cloneLlmChat(restored.llmChat) : cloneLlmChat(sharedState.llmChat)
  };
  if (sharedState.generation?.partialOutput) {
    setOutput(sharedState.generation.partialOutput);
  }
  refreshAskLlmDisplay();
  updatePeers();
  return true;
}

// ---------- UI ----------
function updateStatus(msg, type = 'info') {
  const el = document.getElementById('status');
  if (el) {
    el.textContent = msg;
    el.className = `status ${type}`;
  }
}

function humanizeWorkStatus(status) {
  const map = {
    idle: 'Ready',
    planning: 'Planning',
    running: 'In progress',
    merging: 'Putting it together',
    done: 'Finished',
    error: 'Something went wrong'
  };
  return map[status] || status;
}

function humanizePhase(phase) {
  if (!phase || phase === 'idle') return 'Waiting';
  if (phase === 'plan_stream') return 'Planning steps';
  if (phase === 'delegating') return 'Splitting the work';
  if (phase === 'main_stream') return 'Writing';
  if (String(phase).startsWith('subtask_')) return 'Working on a part';
  return String(phase);
}

function setRoomStatus(msg) {
  const el = document.getElementById('roomStatus');
  if (el) el.innerHTML = msg;
}

function getLanBaseOverride() {
  const el = document.getElementById('lanBaseUrl');
  if (el && typeof el.value === 'string' && el.value.trim()) {
    return el.value.trim().replace(/\/+$/, '');
  }
  try {
    return (localStorage.getItem(LAN_BASE_STORAGE_KEY) || '').trim();
  } catch {
    return '';
  }
}

/**
 * Invite link / QR: if you opened the app as localhost, phones need your PC LAN IP.
 * Override replaces only protocol + host + port; path stays the same.
 */
function buildJoinLink(roomId) {
  if (!roomId) return '';
  const url = new URL(window.location.href);
  const current = new URLSearchParams(window.location.search);
  const raw = getLanBaseOverride();
  if (raw) {
    try {
      const base = new URL(/^https?:\/\//i.test(raw) ? raw : `http://${raw}`);
      url.protocol = base.protocol;
      url.hostname = base.hostname;
      url.port = base.port;
    } catch {
      /* keep window.location host */
    }
  }
  url.hash = '';
  // Preserve safety flags that often fix cross-device invite issues.
  if (current.get('nosw') === '1') url.searchParams.set('nosw', '1');
  if (current.get('offline') === '1') url.searchParams.set('offline', '1');
  url.searchParams.set('room', roomId);
  url.searchParams.set('join', '1');
  url.searchParams.set('invite', '1');
  if (sessionAuthToken) {
    url.searchParams.set('auth', sessionAuthToken);
  }
  return url.toString();
}

/** Query params for invite auto-join: prefer location.search, else #...?room=… (some apps strip search on open). */
function getInviteSearchParams() {
  const fromSearch = new URLSearchParams(window.location.search);
  if (fromSearch.get('room')) return fromSearch;
  const h = window.location.hash.replace(/^#/, '');
  const q = h.indexOf('?');
  if (q >= 0) {
    try {
      const inner = new URLSearchParams(h.slice(q + 1));
      if (inner.get('room')) return inner;
    } catch {
      /* ignore */
    }
  }
  return fromSearch;
}

/** True when URL should auto-fetch offer and join (QR / link). */
function wantsUrlAutoJoin(p) {
  if (!p || typeof p.get !== 'function') return false;
  if (p.get('nojoin') === '1') return false;
  const room = (p.get('room') || '').trim();
  const j = p.get('join');
  if (j != null && j !== '') {
    const lower = String(j).toLowerCase();
    if (lower === '0' || lower === 'false' || lower === 'no' || lower === 'off') return false;
    if (lower === '1' || lower === 'true' || lower === 'yes' || lower === 'on') return true;
    return false;
  }
  if (p.get('invite') === '1' || p.get('autojoin') === '1') return true;
  // index.html?room=abc123 — same room id is enough to auto-connect when signaling is available
  return !!room;
}

async function runInviteAutoJoinFromRoomId(roomId) {
  try {
    let offer = await fetchSignalOfferNow(roomId);
    if (!offer) offer = await pollSignalOfferUntil(roomId, 180000);
    if (offer) {
      const jo = document.getElementById('joinOffer');
      if (jo) jo.value = offer;
      await joinRoom({ fromAutoInvite: true });
      return;
    }
    setRoomStatus(
      `Room <strong>${roomId}</strong> — tap <strong>Join room</strong> when the host is ready. For auto-join, run <code>python3 serve_with_signal.py</code> on the host.`
    );
  } catch (e) {
    log(`Auto-join failed: ${e.message || e}`);
    setRoomStatus(
      `Could not join automatically — tap <strong>Join room</strong>. (${e.message || 'error'})`
    );
  }
}

function refreshInviteLinkHint() {
  const hint = document.getElementById('lanInviteHint');
  if (!hint) return;
  const v = getJoinLinkValue();
  if (!v) {
    hint.style.display = 'none';
    return;
  }
  if (getLanBaseOverride()) {
    hint.style.display = 'none';
    return;
  }
  try {
    const u = new URL(v);
    const bad =
      u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]' || u.hostname === '::1';
    hint.style.display = bad ? 'block' : 'none';
  } catch {
    hint.style.display = 'none';
  }
}

function updateJoinLinkField(roomId) {
  const el = document.getElementById('joinLink');
  if (!el) return;
  el.value = buildJoinLink(roomId);
  refreshInviteLinkHint();
  updateJoinQr();
}

function restoreLanBaseField() {
  const el = document.getElementById('lanBaseUrl');
  if (!el) return;
  try {
    const v = localStorage.getItem(LAN_BASE_STORAGE_KEY);
    if (v && !el.value.trim()) el.value = v;
  } catch {}
}

function fixTypo191To192LanUrl(raw) {
  if (!raw || !/191\.168\./i.test(raw)) return raw;
  const fixed = raw.replace(/191\.168\./gi, '192.168.');
  log('LAN URL had 191.168 — auto-corrected to 192.168 (typo).');
  return fixed;
}

function applyLanBaseToInviteLink() {
  const el = document.getElementById('lanBaseUrl');
  let raw = el && typeof el.value === 'string' ? el.value.trim().replace(/\/+$/, '') : '';
  raw = fixTypo191To192LanUrl(raw);
  if (el && raw !== el.value.trim().replace(/\/+$/, '')) {
    el.value = raw;
  }
  try {
    if (!raw) {
      localStorage.removeItem(LAN_BASE_STORAGE_KEY);
    } else {
      new URL(/^https?:\/\//i.test(raw) ? raw : `http://${raw}`);
      localStorage.setItem(LAN_BASE_STORAGE_KEY, raw);
    }
  } catch {
    setRoomStatus(
      'Invalid URL. Example: <code>http://192.168.1.10:8000</code> — use your PC’s Wi‑Fi IP and the same port as the server (often 8000).'
    );
    return;
  }
  if (P2PAgents.roomId) {
    updateJoinLinkField(P2PAgents.roomId);
    setRoomStatus(
      'Invite link and QR updated — <strong>scan again</strong>. If the page still refuses: confirm <code>python3 serve_with_signal.py</code> is running on the host and macOS/Windows firewall allows port <strong>8000</strong>.'
    );
  } else {
    setRoomStatus('Saved. When you create a room, invite link and QR will use this address.');
  }
  refreshInviteLinkHint();
}

function getJoinLinkValue() {
  const el = document.getElementById('joinLink');
  return el && typeof el.value === 'string' ? el.value.trim() : '';
}

function updateJoinQr() {
  const img = document.getElementById('joinQrImg');
  const msg = document.getElementById('joinQrMsg');
  const link = getJoinLinkValue();
  if (!img || !link) return false;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    img.removeAttribute('src');
    if (msg) msg.textContent = 'Offline: use “Copy invite link” (no external QR service).';
    return true;
  }
  const encoded = encodeURIComponent(link);
  img.onerror = () => {
    if (msg) msg.textContent = 'QR could not load. Use “Copy invite link” instead.';
  };
  img.onload = () => {
    if (msg) msg.textContent = '';
  };
  img.src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encoded}`;
  return true;
}

function toggleJoinQr() {
  const wrap = document.getElementById('joinQrWrap');
  const btn = document.getElementById('joinQrBtn');
  if (!wrap) return;
  const link = getJoinLinkValue();
  if (!link) {
    setRoomStatus('Create a room first to show a QR code.');
    return;
  }
  if (wrap.style.display === 'flex') {
    wrap.style.display = 'none';
    if (btn) btn.textContent = 'Show QR code';
    return;
  }
  const ok = updateJoinQr();
  if (!ok) return;
  wrap.style.display = 'flex';
  if (btn) btn.textContent = 'Hide QR code';
}

function log(msg) {
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
  console.info('[SouthStack P2P]', msg);
  const el = document.getElementById('messages');
  if (!el) return;
  el.innerHTML += `${line}\n`;
  el.scrollTop = el.scrollHeight;
}

function updatePeers() {
  const countEl = document.getElementById('peerCount');
  const listEl = document.getElementById('peers');
  const peerCount = P2PAgents.knownPeerIds.size;
  if (countEl) countEl.textContent = String(peerCount);
  const topDeviceCountEl = document.getElementById('topDeviceCount');
  if (topDeviceCountEl) {
    topDeviceCountEl.textContent = `${peerCount} ${peerCount === 1 ? 'device' : 'devices'}`;
  }
  if (listEl) {
    const rows = Array.from(P2PAgents.knownPeerIds).map(id => {
      const short = id.slice(0, 8);
      const tag = id === localPeerId ? ' (this device)' : '';
      const lead = id === P2PAgents.leaderId ? ' (coordinator)' : '';
      const gpu = peerWebGpuByPeer.get(id) === true ? ' · WebGPU' : '';
      const isCoord = id === currentCoordinator ? ' 👑 AI Coordinator' : '';
      return `<div class="peer">Device ${short}${tag}${lead}${isCoord}${gpu}</div>`;
    });
    listEl.innerHTML = rows.join('');
  }
  const pid = document.getElementById('myPeerId');
  if (pid) pid.textContent = localPeerId.slice(0, 13) + '…';
  const lid = document.getElementById('leaderId');
  if (lid) lid.textContent = P2PAgents.leaderId ? P2PAgents.leaderId.slice(0, 13) + '…' : '—';
  const ft = document.getElementById('ftStatus');
  if (ft) {
    ft.textContent = `Saved update #${sharedState.version} · ${humanizeWorkStatus(sharedState.status)} · ${humanizePhase(sharedState.generation.phase)}`;
  }
  updateHostGuestTaskUi();
  refreshAskLlmDisplay();
  
  // Check if coordinator election is needed
  setTimeout(() => checkCoordinatorNeeded(), 1000);
}

function updateHostGuestTaskUi() {
  const hint = document.getElementById('guestJobHint');
  const taskEl = document.getElementById('taskInput');
  const btn = document.getElementById('startSharedJobBtn');
  const heading = document.getElementById('taskSectionHeading');
  if (!hint || !taskEl || !btn) return;
  const multi = P2PAgents.knownPeerIds.size > 1;
  const guest = multi && !P2PAgents.isLeader;
  hint.style.display = guest ? 'block' : 'none';
  taskEl.disabled = guest;
  btn.disabled = guest;
  if (heading) {
    heading.textContent = guest ? 'Coding job (coordinator starts on their device)' : 'Send a coding job (coordinator only)';
  }
}

function appendOutput(text) {
  const out = document.getElementById('output');
  if (out) out.textContent = (out.textContent || '') + text;
}

function setOutput(text) {
  const out = document.getElementById('output');
  if (out) out.textContent = text;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function voicePrefs() {
  try {
    return {
      speak: localStorage.getItem(VOICE_KEY_SPEAK) !== '0',
      autoSendAsk: localStorage.getItem(VOICE_KEY_AUTOSEND) !== '0'
    };
  } catch {
    return { speak: true, autoSendAsk: true };
  }
}

function voiceSetSpeak(on) {
  try {
    if (on) localStorage.removeItem(VOICE_KEY_SPEAK);
    else localStorage.setItem(VOICE_KEY_SPEAK, '0');
  } catch {
    /* ignore */
  }
}

function voiceSetAutoSendAsk(on) {
  try {
    if (on) localStorage.removeItem(VOICE_KEY_AUTOSEND);
    else localStorage.setItem(VOICE_KEY_AUTOSEND, '0');
  } catch {
    /* ignore */
  }
}

function stripForSpeech(s) {
  return String(s || '')
    .replace(/```[\s\S]*?```/g, ' code block. ')
    .replace(/`[^`]+`/g, ' ')
    .replace(/\[[^\]]+\]\([^)]+\)/g, ' ')
    .replace(/#+\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 8000);
}

function stopSpeaking() {
  try {
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
  } catch {
    /* ignore */
  }
}

/** Mark existing assistant messages as already “heard” so we do not speak history on load. */
function voiceSyncBaselineFromChat() {
  const items = sharedState.llmChat?.items || [];
  for (let i = items.length - 1; i >= 0; i--) {
    const m = items[i];
    if (m && m.role === 'assistant' && m.id) {
      voiceLastSpokenMsgId = m.id;
      return;
    }
  }
  voiceLastSpokenMsgId = '';
}

function voiceMaybeSpeakLastAssistant() {
  if (!voicePrefs().speak) return;
  if (typeof speechSynthesis === 'undefined') return;
  const chat = sharedState.llmChat;
  if (!chat || chat.busy || chat.streamPartial) return;
  const items = chat.items || [];
  const last = items[items.length - 1];
  if (!last || last.role !== 'assistant') return;
  const text = String(last.content || '').trim();
  if (!text) return;
  const id = last.id || '';
  if (id && id === voiceLastSpokenMsgId) return;
  voiceLastSpokenMsgId = id || `spoke_${Date.now()}`;
  voiceQueueSpeak(stripForSpeech(text));
}

function getSpeechRecognitionCtor() {
  return typeof window !== 'undefined'
    ? window.SpeechRecognition || window.webkitSpeechRecognition || null
    : null;
}

/**
 * Chrome/Chromium often need an explicit mic grant before SpeechRecognition works.
 * We request audio briefly then stop tracks so the recognizer can run.
 */
async function voicePrimeMicPermission() {
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
    return { ok: true };
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach(t => {
      try {
        t.stop();
      } catch {
        /* ignore */
      }
    });
    voiceLastError = '';
    return { ok: true };
  } catch (e) {
    const name = e && e.name ? e.name : 'Error';
    const msg = e && e.message ? e.message : String(e);
    voiceLastError = `getUserMedia: ${name} — ${msg}`;
    return { ok: false, name, message: msg };
  }
}

function voiceQueueSpeak(text) {
  if (!text || typeof speechSynthesis === 'undefined') return;
  const run = () => {
    try {
      speechSynthesis.cancel();
      try {
        speechSynthesis.resume();
      } catch {
        /* ignore */
      }
      const u = new SpeechSynthesisUtterance(text);
      u.lang = navigator.language || 'en-US';
      u.onerror = ev => {
        voiceLastError = `TTS: ${ev?.error || 'error'}`;
        console.warn('[SouthStack P2P] Voice TTS error:', ev?.error || ev);
      };
      speechSynthesis.speak(u);
    } catch (e) {
      voiceLastError = `TTS: ${e?.message || e}`;
      console.warn('[SouthStack P2P] Voice speak:', e);
    }
  };
  const voices = speechSynthesis.getVoices?.() || [];
  if (voices.length > 0) {
    run();
    return;
  }
  const onVoices = () => {
    try {
      speechSynthesis.removeEventListener('voiceschanged', onVoices);
    } catch {
      /* ignore */
    }
    run();
  };
  speechSynthesis.addEventListener('voiceschanged', onVoices);
  setTimeout(() => {
    try {
      speechSynthesis.removeEventListener('voiceschanged', onVoices);
    } catch {
      /* ignore */
    }
    run();
  }, 750);
}

/** @type {string} */
let voiceBaseValue = '';

function updateVoiceMicButtons() {
  const askBtn = document.getElementById('voiceMicAskBtn');
  const taskBtn = document.getElementById('voiceMicTaskBtn');
  for (const b of [askBtn, taskBtn]) {
    if (!b) continue;
    const isThis =
      voiceListening &&
      ((b === askBtn && voiceBoundField === document.getElementById('askLlmInput')) ||
        (b === taskBtn && voiceBoundField === document.getElementById('taskInput')));
    b.classList.toggle('voice-mic-listening', !!isThis);
    b.setAttribute('aria-pressed', isThis ? 'true' : 'false');
  }
}

function stopVoiceListening(fromUserIntent = false) {
  if (fromUserIntent) voiceUserRequestedStop = true;
  if (fromUserIntent) voiceSessionActive = false;
  if (!voiceRecognition) {
    voiceListening = false;
    if (fromUserIntent) {
      const wasAsk = voiceBoundField === document.getElementById('askLlmInput');
      voiceBoundField = null;
      voiceUserRequestedStop = false;
      updateVoiceMicButtons();
      if (wasAsk) voiceTryAutoSendAsk();
    } else {
      updateVoiceMicButtons();
    }
    return;
  }
  try {
    voiceRecognition.stop();
  } catch {
    /* ignore */
  }
}

function voiceTryAutoSendAsk() {
  const p = voicePrefs();
  const field = document.getElementById('askLlmInput');
  if (!p.autoSendAsk || !field) return;
  const t = typeof field.value === 'string' ? field.value.trim() : '';
  if (!t) return;
  void askCodingLLM();
}

function setVoiceInlineHint(text) {
  const el = document.getElementById('voiceInlineHint');
  if (el) el.textContent = text || '';
}

async function startVoiceListeningForField(fieldId) {
  const field = document.getElementById(fieldId);
  const SR = getSpeechRecognitionCtor();
  if (!field || (field.tagName !== 'TEXTAREA' && field.tagName !== 'INPUT')) {
    log('Voice: field not found.');
    return;
  }
  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    setVoiceInlineHint(
      'Tip: if the mic does nothing, open via https:// or http://localhost — plain http:// on a LAN IP is often blocked.'
    );
  }
  if (!SR) {
    voiceLastError = 'SpeechRecognition API missing';
    log('Voice input is not supported in this browser (needs Speech Recognition). Try Chrome / Edge.');
    setVoiceInlineHint('Voice dictation needs Chrome or Edge (Web Speech API).');
    return;
  }


  if (voiceListening && voiceBoundField === field) {
    stopVoiceListening(true);
    return;
  }

  if (voiceStartInProgress) {
    log('Voice: starting — please wait a moment.');
    return;
  }
  voiceStartInProgress = true;
  try {
    const prime = await voicePrimeMicPermission();
    if (!prime.ok) {
      log(`Voice: ${voiceLastError}`);
      setVoiceInlineHint(
        'Microphone blocked or unavailable. Allow microphone for this site (lock icon in the address bar), then try again.'
      );
      return;
    }

    const sessionGen = ++voiceTurnGeneration;
    if (voiceListening) stopVoiceListening(false);

    stopSpeaking();
    setVoiceInlineHint('Listening… speak now. Tap the mic again to stop.');
    voiceBoundField = field;
    voiceBaseValue = typeof field.value === 'string' ? field.value : '';
    voiceFinalTranscript = '';
    voiceListening = true;
    voiceSessionActive = true;
    voiceUserRequestedStop = false;
    updateVoiceMicButtons();

    let segmentRestartsLeft = 24;

    function wireRecognition(rec) {
    voiceRecognition = rec;
    rec.lang = navigator.language || 'en-US';
    rec.continuous = true;
    rec.interimResults = true;
    try {
      rec.maxAlternatives = 1;
    } catch {
      /* ignore */
    }

    rec.onresult = ev => {
      if (sessionGen !== voiceTurnGeneration || !voiceBoundField) return;
      let interim = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        const piece = (r[0] && r[0].transcript) || '';
        if (r.isFinal) voiceFinalTranscript += piece;
        else interim += piece;
      }
      let tail = voiceFinalTranscript + interim;
      if (voiceBaseValue && tail && !/\s$/.test(voiceBaseValue) && !/^\s/.test(tail)) tail = ` ${tail}`;
      voiceBoundField.value = voiceBaseValue + tail;
    };

    rec.onerror = ev => {
      const msg = ev.error || 'unknown';
      if (sessionGen !== voiceTurnGeneration) return;
      voiceLastError = `recognition: ${msg}`;
      if (msg === 'not-allowed' || msg === 'service-not-allowed') {
        voiceSessionActive = false;
        voiceListening = false;
        voiceBoundField = null;
        voiceRecognition = null;
        voiceUserRequestedStop = false;
        updateVoiceMicButtons();
        log('Voice: microphone blocked — allow microphone for this site in browser settings.');
        setVoiceInlineHint('Microphone blocked — check browser site permissions.');
        return;
      }
      if (msg === 'network') {
        log('Voice: network error — Chrome speech recognition needs internet (cloud). Check connection / VPN / ad-blockers.');
        setVoiceInlineHint(
          'Voice recognition needs internet: Chrome sends audio to Google. Go online, disable strict blockers, or try another network.'
        );
        voiceSessionActive = false;
        voiceListening = false;
        voiceBoundField = null;
        voiceRecognition = null;
        updateVoiceMicButtons();
        return;
      }
      if (msg === 'audio-capture') {
        log('Voice: no microphone found or capture failed.');
        setVoiceInlineHint('No microphone detected or capture failed — plug in a mic and allow access.');
        voiceSessionActive = false;
        voiceListening = false;
        voiceBoundField = null;
        voiceRecognition = null;
        updateVoiceMicButtons();
        return;
      }
      if (msg !== 'aborted' && msg !== 'no-speech') log(`Voice: ${msg}`);
    };

    rec.onend = () => {
      if (sessionGen !== voiceTurnGeneration) return;
      voiceRecognition = null;

      if (voiceUserRequestedStop) {
        voiceUserRequestedStop = false;
        voiceSessionActive = false;
        voiceListening = false;
        const wasAsk = voiceBoundField === document.getElementById('askLlmInput');
        voiceBoundField = null;
        updateVoiceMicButtons();
        if (wasAsk) voiceTryAutoSendAsk();
        setVoiceInlineHint('');
        return;
      }

      if (voiceSessionActive && voiceBoundField && segmentRestartsLeft > 0) {
        segmentRestartsLeft -= 1;
        try {
          const Next = getSpeechRecognitionCtor();
          if (!Next) {
            voiceSessionActive = false;
            voiceListening = false;
            voiceBoundField = null;
            updateVoiceMicButtons();
            return;
          }
          const nr = new Next();
          wireRecognition(nr);
          nr.start();
        } catch (e) {
          log(`Voice: could not continue (${e.message || e}).`);
          voiceSessionActive = false;
          voiceListening = false;
          voiceBoundField = null;
          updateVoiceMicButtons();
        }
        return;
      }

      voiceSessionActive = false;
      voiceListening = false;
      voiceBoundField = null;
      updateVoiceMicButtons();
      setVoiceInlineHint('');
    };
    }

    try {
      const rec = new SR();
      wireRecognition(rec);
      rec.start();
      voiceLastError = '';
    } catch (e) {
      voiceSessionActive = false;
      voiceListening = false;
      voiceBoundField = null;
      voiceRecognition = null;
      updateVoiceMicButtons();
      const err = e?.message || String(e);
      voiceLastError = `start: ${err}`;
      log(`Voice: could not start (${err}).`);
      if (typeof window !== 'undefined' && window.isSecureContext === false) {
        setVoiceInlineHint('Voice needs a secure origin: use https:// or http://127.0.0.1 — not http://192.168… in Chrome.');
      } else if (/secure|permission|not allowed/i.test(err)) {
        setVoiceInlineHint('Voice failed to start — allow the microphone or try HTTPS / localhost.');
      }
    }
  } finally {
    voiceStartInProgress = false;
  }
}

function updateVoiceSettingsMenuLabels() {
  const p = voicePrefs();
  const speakBtn = document.getElementById('waVoiceSpeakToggle');
  const autoBtn = document.getElementById('waVoiceAutoSendToggle');
  if (speakBtn) speakBtn.textContent = p.speak ? 'Voice: speak replies — On' : 'Voice: speak replies — Off';
  if (autoBtn) autoBtn.textContent = p.autoSendAsk ? 'Voice: auto-send Ask — On' : 'Voice: auto-send Ask — Off';
}

function initVoiceControls() {
  if (typeof window !== 'undefined' && window.__southstackVoiceUiInit) return;
  if (typeof window !== 'undefined') window.__southstackVoiceUiInit = true;

  const speakBtn = document.getElementById('waVoiceSpeakToggle');
  const autoBtn = document.getElementById('waVoiceAutoSendToggle');
  if (speakBtn) {
    speakBtn.addEventListener('click', () => {
      voiceSetSpeak(!voicePrefs().speak);
      updateVoiceSettingsMenuLabels();
    });
  }
  if (autoBtn) {
    autoBtn.addEventListener('click', () => {
      voiceSetAutoSendAsk(!voicePrefs().autoSendAsk);
      updateVoiceSettingsMenuLabels();
    });
  }
  updateVoiceSettingsMenuLabels();
}

function isProgrammingPrompt(text) {
  const raw = String(text || '').trim();
  if (!raw) return false;
  const t = raw.toLowerCase();
  if (/```|[{}[\];<>]|=>|==|!=|\bdef\b|\bclass\b|\bfunction\b/.test(raw)) return true;
  return /\b(program|programming|code|coding|algorithm|data structure|array|string|loop|function|class|object|debug|bug|error|exception|compile|runtime|api|json|sql|database|frontend|backend|web|html|css|javascript|typescript|python|java|golang|go\b|rust|c\+\+|c#|c language|c programming|node|react|linux|bash|shell|git|webgpu|webrtc|llm|machine learning|ai model)\b/.test(
    t
  );
}

function hideAskLoadBanner() {
  const ban = document.getElementById('askLlmLoadBanner');
  if (ban) {
    ban.style.display = 'none';
    ban.textContent = '';
  }
}

/** Build WhatsApp-style bubbles (HTML) from sharedState.llmChat + optional guest pending line. */
function renderLlmChatHtml() {
  const c = sharedState.llmChat;
  const parts = [];
  for (const m of c.items || []) {
    const short = (m.fromPeerId || '').slice(0, 8) || '?';
    const you = m.fromPeerId === localPeerId;
    const who = you ? 'You' : `Device ${short}`;
    if (m.role === 'user') {
      parts.push(
        `<div class="wa-row wa-row-out"><div class="wa-bubble wa-bubble-out"><span class="wa-meta">${escapeHtml(who)}</span><div class="wa-text">${escapeHtml(m.content)}</div></div></div>`
      );
    } else {
      parts.push(
        `<div class="wa-row wa-row-in"><div class="wa-bubble wa-bubble-in"><span class="wa-meta">Assistant</span><div class="wa-text">${escapeHtml(m.content)}</div></div></div>`
      );
    }
  }
  if (c.streamPartial) {
    parts.push(
      `<div class="wa-row wa-row-in"><div class="wa-bubble wa-bubble-in wa-bubble-streaming"><span class="wa-meta">Assistant</span><div class="wa-text">${escapeHtml(c.streamPartial)}</div><span class="wa-cursor">▋</span></div></div>`
    );
  }
  if (pendingGuestPrompt) {
    parts.push(
      `<div class="wa-row wa-row-out"><div class="wa-bubble wa-bubble-out wa-bubble-pending"><span class="wa-meta">You</span><div class="wa-text">${escapeHtml(pendingGuestPrompt)}</div><span class="wa-sending">Sending to coordinator…</span></div></div>`
    );
  }
  return parts.join('');
}

/** Render shared Ask thread (solo + linked). */
function updateAskUiLocks() {
  const btn = document.getElementById('askLlmBtn');
  const stopBtn = document.getElementById('askLlmStopBtn');
  if (!btn) return;
  const linked = channelsByPeer.size >= 1;
  const busy = !!sharedState.llmChat.busy;
  const guestWait = linked && !P2PAgents.isLeader && !!pendingGuestPrompt;
  btn.disabled = busy || guestWait;
  if (stopBtn) stopBtn.disabled = !(busy || guestWait);
}

function refreshAskLlmDisplay() {
  const out = document.getElementById('askLlmOutput');
  if (!out) return;
  const html = renderLlmChatHtml();
  if (!html) {
    out.innerHTML =
      '<div class="wa-empty">Messages appear here. When two or more devices are in the same room, everyone sees the same questions and answers. Type below and tap Ask.</div>';
  } else {
    out.innerHTML = html;
    out.scrollTop = out.scrollHeight;
  }
  updateAskUiLocks();
  voiceMaybeSpeakLastAssistant();
}

function enqueueLeaderLlm(task) {
  const p = leaderLlmTail.then(() => task());
  leaderLlmTail = p.catch(() => {});
  return p;
}

/**
 * Coordinator (lowest peer id = “host”) runs WebGPU inference; everyone sees the same streamed reply.
 */
async function runSharedLlmOnLeader(prompt, fromPeerId) {
  const chat = sharedState.llmChat;
  chat.busy = true;
  chat.runPeerId = localPeerId;
  chat.streamPartial = '';
  const msgId = `m_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  let stopRequested = false;
  let stopRequestedByPeer = null;
  const thisRunStop = ({ byPeerId } = {}) => {
    stopRequested = true;
    if (byPeerId) stopRequestedByPeer = byPeerId;
  };
  activeSharedAskStop = thisRunStop;
  const finishChat = (assistantContent, isStopped = false) => {
    chat.items.push({
      id: `${msgId}_a`,
      role: 'assistant',
      fromPeerId: localPeerId,
      content: assistantContent,
      at: Date.now()
    });
    chat.streamPartial = '';
    chat.busy = false;
    chat.runPeerId = null;
    bumpVersion();
    broadcast({ type: 'llm_shared_done', llmChat: cloneLlmChat(chat) });
    broadcastState();
    refreshAskLlmDisplay();
    if (isStopped) {
      const by = stopRequestedByPeer ? ` by ${(stopRequestedByPeer || '').slice(0, 8)}…` : '';
      log(`Shared Ask stopped${by}.`);
    } else {
      log(`Shared Ask done (requested by ${(fromPeerId || '').slice(0, 8) || '?'}…).`);
    }
  };
  chat.items.push({
    id: msgId,
    role: 'user',
    fromPeerId,
    content: prompt,
    at: Date.now()
  });
  bumpVersion();
  broadcastState();
  refreshAskLlmDisplay();

  if (!isProgrammingPrompt(prompt)) {
    finishChat(NON_CODING_REPLY, false);
    return;
  }

  engineInitUiTarget = 'ask';
  try {
    await initEngine();
    engineInitUiTarget = null;
    hideAskLoadBanner();
    if (stopRequested) {
      finishChat('Stopped before generation started.', true);
      return;
    }
    let full = '';
    const stream = await engine.chat.completions.create({
      messages: [
        {
          role: 'system',
          content: CODING_ASSISTANT_SYSTEM_PROMPT
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      max_tokens: 768,
      stream: true,
      temperature: 0.2
    });
    if (stopRequested) {
      const by = stopRequestedByPeer ? ` by device ${(stopRequestedByPeer || '').slice(0, 8)}…` : '';
      finishChat(`[Stopped${by}]`, true);
      return;
    }
    for await (const chunk of stream) {
      if (stopRequested) break;
      const delta = streamChunkText(chunk);
      if (!delta) continue;
      full += delta;
      chat.streamPartial = full;
      broadcast({ type: 'llm_shared_token', partial: full, fromPeerId: localPeerId });
      refreshAskLlmDisplay();
    }
    if (stopRequested) {
      const by = stopRequestedByPeer ? ` by device ${(stopRequestedByPeer || '').slice(0, 8)}…` : '';
      finishChat(`${full}${full ? '\n\n' : ''}[Stopped${by}]`, true);
    } else {
      finishChat(full || '(No output)', false);
    }
  } catch (e) {
    if (stopRequested) {
      const by = stopRequestedByPeer ? ` by device ${(stopRequestedByPeer || '').slice(0, 8)}…` : '';
      finishChat(`[Stopped${by}]`, true);
      return;
    }
    const err = e?.message || String(e);
    chat.streamPartial = '';
    chat.busy = false;
    chat.runPeerId = null;
    chat.items.push({
      id: `${msgId}_err`,
      role: 'assistant',
      fromPeerId: localPeerId,
      content: `Error: ${err}`,
      at: Date.now()
    });
    bumpVersion();
    broadcast({ type: 'llm_shared_done', llmChat: cloneLlmChat(chat) });
    broadcastState();
    refreshAskLlmDisplay();
  } finally {
    engineInitUiTarget = null;
    hideAskLoadBanner();
    if (activeSharedAskStop === thisRunStop) activeSharedAskStop = null;
  }
}

// ---------- Leader election: prefer WebGPU-capable peers, then lowest id (deterministic) ----------
/** Peers we can actually message (open data channel), plus self. Gossip may list others in star topology. */
function connectedPeerIdsForElection() {
  const connected = new Set([localPeerId, ...channelsByPeer.keys()]);
  return Array.from(P2PAgents.knownPeerIds).filter(id => connected.has(id));
}

function isPeerReachableForWork(peerId) {
  if (!peerId) return false;
  if (peerId === localPeerId) return true;
  const ch = channelsByPeer.get(peerId);
  return !!(ch && ch.readyState === 'open');
}

/**
 * Deterministic host election: among peers we are connected to (open data channel + self),
 * the host is the lexicographically smallest peerId. Same inputs → same host everywhere → no election storm.
 */
function computeLeader() {
  const ids = connectedPeerIdsForElection();
  if (ids.length === 0) return localPeerId;
  const sorted = [...ids].sort((a, b) => a.localeCompare(b));
  return sorted[0];
}

function stopHostHeartbeatTimer() {
  if (hostHeartbeatTimer) {
    clearInterval(hostHeartbeatTimer);
    hostHeartbeatTimer = null;
  }
}

function stopClientHostWatchdog() {
  if (clientHostWatchdogTimer) {
    clearInterval(clientHostWatchdogTimer);
    clientHostWatchdogTimer = null;
  }
}

function ensureHostCoordinationTimers() {
  if (P2PAgents.isLeader && channelsByPeer.size > 0) {
    stopClientHostWatchdog();
    if (!hostHeartbeatTimer) {
      broadcast({ type: 'heartbeat', from: localPeerId });
      hostHeartbeatTimer = setInterval(() => {
        if (!P2PAgents.isLeader || channelsByPeer.size === 0) return;
        broadcast({ type: 'heartbeat', from: localPeerId });
      }, HOST_HEARTBEAT_INTERVAL_MS);
    }
  } else if (!P2PAgents.isLeader && channelsByPeer.size > 0 && P2PAgents.leaderId) {
    stopHostHeartbeatTimer();
    if (!clientHostWatchdogTimer) {
      clientHostWatchdogTimer = setInterval(() => {
        checkClientHostHeartbeatWatchdog();
      }, 1000);
    }
  } else {
    stopHostHeartbeatTimer();
    stopClientHostWatchdog();
  }
}

function checkClientHostHeartbeatWatchdog() {
  if (P2PAgents.isLeader) return;
  if (channelsByPeer.size === 0 || !P2PAgents.leaderId) return;
  if (Date.now() < hostFailoverCooldownUntil) return;
  const now = Date.now();
  if (!lastHostHeartbeatAt || now - lastHostHeartbeatAt < HOST_HEARTBEAT_MISS_MS) return;
  void performHostFailoverDueToMissedHeartbeat();
}

function performHostFailoverDueToMissedHeartbeat() {
  const leader = P2PAgents.leaderId;
  if (!leader || P2PAgents.isLeader) return;
  if (Date.now() < hostFailoverCooldownUntil) return;
  hostFailoverCooldownUntil = Date.now() + HOST_FAILOVER_COOLDOWN_MS;
  console.info('[FAILOVER] Host lost → electing new host');
  log('[FAILOVER] Host lost → electing new host');
  const dc = channelsByPeer.get(leader);
  if (dc) {
    try {
      dc.close();
    } catch {
      /* ignore */
    }
    // onTransportGone runs from channel onclose; if it did not fire, fall back once.
    queueMicrotask(() => {
      if (channelsByPeer.has(leader)) {
        onTransportGone(leader, 'host_heartbeat_lost');
      }
    });
  } else {
    applyLeader();
    reassignOrphanSubtasks();
    void (async () => {
      await flushPendingSubtasksAfterFailover();
      await continueGenerationAfterFailover();
    })();
  }
  lastHostHeartbeatAt = Date.now();
}

function applyLeader() {
  const wasLeader = P2PAgents.isLeader;
  const was = P2PAgents.leaderId;
  P2PAgents.leaderId = computeLeader();
  P2PAgents.isLeader = P2PAgents.leaderId === localPeerId;
  P2PAgents.role = P2PAgents.isLeader ? 'host' : 'client';

  const roleLine = P2PAgents.isLeader ? '[ROLE] I am HOST' : '[ROLE] I am CLIENT';
  if (lastLoggedRole !== P2PAgents.role) {
    lastLoggedRole = P2PAgents.role;
    console.info(roleLine);
    log(roleLine);
  }

  if (was !== P2PAgents.leaderId) {
    log(`Host device: ${P2PAgents.leaderId.slice(0, 8)}… (${P2PAgents.isLeader ? 'this device' : 'another device'})`);
    console.info(`[ELECTION] New host elected: ${P2PAgents.leaderId}`);
    log(`[ELECTION] New host elected: ${P2PAgents.leaderId}`);
    lastElectedHostId = P2PAgents.leaderId;
  }

  lastHostHeartbeatAt = Date.now();

  if (!wasLeader && P2PAgents.isLeader) {
    log(
      'This device is now the coordinator (WhatsApp-style: one Ask at a time; everyone sees the reply). Preloading the model if WebGPU is available…'
    );
    void initEngine().catch(() => {
      log(
        'AI could not load on this device — use a desktop Chrome with WebGPU for Ask, or reconnect a PC that was coordinator before.'
      );
    });
    try {
      broadcastState();
    } catch {
      /* ignore */
    }
  }
  currentCoordinator = P2PAgents.leaderId;
  isLocalCoordinator = P2PAgents.isLeader;
  updateCoordinatorUI();

  ensureHostCoordinationTimers();
  updatePeers();
}

function touchPeerStat(peerId, patch = {}) {
  if (!peerId) return;
  const prev = peerStats.get(peerId) || {
    rttMs: TASK_ACK_TIMEOUT_MS,
    inflight: 0,
    done: 0,
    fail: 0,
    lastSeenAt: Date.now(),
    webgpu: peerWebGpuByPeer.get(peerId) === true
  };
  const next = { ...prev, ...patch, lastSeenAt: Date.now() };
  peerStats.set(peerId, next);
}

function getPeerDispatchScore(peerId) {
  if (!peerId) return Number.NEGATIVE_INFINITY;
  const stat = peerStats.get(peerId) || {
    rttMs: TASK_ACK_TIMEOUT_MS,
    inflight: 0,
    done: 0,
    fail: 0,
    webgpu: peerWebGpuByPeer.get(peerId) === true
  };
  const gpuBoost = stat.webgpu ? 0.4 : 0;
  const reliability = Math.max(0, stat.done - stat.fail) * 0.05;
  const inflightPenalty = stat.inflight * 0.35;
  const rttPenalty = Math.min(1.2, (stat.rttMs || TASK_ACK_TIMEOUT_MS) / 10000);
  return 1 + gpuBoost + reliability - inflightPenalty - rttPenalty;
}

function chooseAssigneeForSubtask() {
  const candidates = Array.from(P2PAgents.knownPeerIds).filter(id => {
    if (id === localPeerId) return true;
    const ch = channelsByPeer.get(id);
    return !!(ch && ch.readyState === 'open');
  });
  if (!candidates.length) return localPeerId;
  candidates.sort((a, b) => getPeerDispatchScore(b) - getPeerDispatchScore(a));
  return candidates[0] || localPeerId;
}

function persistSessionSnapshot() {
  try {
    const snap = {
      roomId: P2PAgents.roomId || '',
      invite: getJoinLinkValue(),
      wasLeader: !!P2PAgents.isLeader,
      authToken: sessionAuthToken || '',
      at: Date.now()
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(snap));
  } catch {
    /* ignore */
  }
}

function clearSessionSnapshot() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

function readSessionSnapshot() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (!parsed.roomId || typeof parsed.roomId !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

function scheduleAutoReconnect(reason = 'link lost') {
  if (!P2PAgents.roomId || channelsByPeer.size > 0) return;
  if (reconnectTimer) return;
  if (reconnectAttempt >= RECONNECT_MAX_ATTEMPTS) {
    updateStatus('Reconnect paused after many failed attempts. Use Join room or Start session.', 'disconnected');
    log('Auto-reconnect paused after repeated failures.');
    return;
  }
  const idx = Math.min(reconnectAttempt, RECONNECT_BACKOFF_MS.length - 1);
  const baseDelay = RECONNECT_BACKOFF_MS[idx];
  const jitter = Math.floor(Math.random() * 650);
  const delay = baseDelay + jitter;
  reconnectAttempt += 1;
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    if (!P2PAgents.roomId || channelsByPeer.size > 0) return;
    log(`Auto-reconnect (${reason}) attempt ${reconnectAttempt}…`);
    try {
      if (P2PAgents.isLeader) {
        await generateNextOffer();
      } else {
        const rid = document.getElementById('roomId');
        if (rid) rid.value = P2PAgents.roomId;
        await joinRoom({ fromAutoInvite: true, fromReconnect: true });
      }
    } catch {
      /* joinRoom handles status */
    } finally {
      if (channelsByPeer.size === 0) {
        const retryReason = P2PAgents.isLeader ? 'host offer retry' : 'join retry';
        scheduleAutoReconnect(retryReason);
      } else {
        reconnectAttempt = 0;
      }
    }
  }, delay);
}

function cancelAutoReconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  reconnectAttempt = 0;
}

function resetMetrics(taskId) {
  metricsState = {
    taskId: taskId || null,
    startedAt: Date.now(),
    finishedAt: 0,
    responseTimeMs: 0,
    retries: 0,
    failures: 0,
    transportDrops: 0,
    subtaskCount: 0,
    peerUtilization: {},
    outputQualityNotes: []
  };
}

function ensurePeerMetric(peerId) {
  if (!peerId) return;
  if (!metricsState.peerUtilization[peerId]) {
    metricsState.peerUtilization[peerId] = { assigned: 0, completed: 0, failed: 0 };
  }
}

function noteQuality(message) {
  if (!message) return;
  metricsState.outputQualityNotes.push(message);
  if (metricsState.outputQualityNotes.length > 20) {
    metricsState.outputQualityNotes = metricsState.outputQualityNotes.slice(-20);
  }
}

function finalizeMetricsAndPersist() {
  metricsState.finishedAt = Date.now();
  metricsState.responseTimeMs = Math.max(0, metricsState.finishedAt - (metricsState.startedAt || metricsState.finishedAt));
  try {
    localStorage.setItem(METRICS_DB_KEY, JSON.stringify(metricsState));
  } catch {
    /* ignore */
  }
}

function getLatestMetrics() {
  try {
    const raw = localStorage.getItem(METRICS_DB_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ---------- Messaging ----------
function newMessageId() {
  return `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function toWireEnvelope(raw, to = null) {
  if (!raw || typeof raw !== 'object' || !raw.type) return null;
  const { type, ...rest } = raw;
  return {
    id: raw.id || newMessageId(),
    type,
    payload: rest,
    timestamp: Date.now(),
    from: localPeerId,
    ...(to ? { to } : {})
  };
}

function normalizeIncomingMessage(raw) {
  if (!raw || typeof raw !== 'object') return null;
  // Standard envelope
  if (raw.type && raw.payload && typeof raw.payload === 'object') {
    return {
      id: raw.id || null,
      type: raw.type,
      from: raw.from || null,
      to: raw.to || null,
      timestamp: raw.timestamp || Date.now(),
      ...raw.payload
    };
  }
  // Backward-compatible legacy shape
  if (raw.type) {
    return {
      id: raw.id || null,
      type: raw.type,
      from: raw.from || null,
      timestamp: raw.timestamp || Date.now(),
      ...raw
    };
  }
  return null;
}

function sendOnChannel(dc, msg, toPeerId = null) {
  if (!dc || dc.readyState !== 'open') return false;
  const wire = toWireEnvelope(msg, toPeerId || dc._remotePeerId || null);
  if (!wire) return false;
  try {
    const bytes = JSON.stringify(wire);
    const remoteId = toPeerId || dc._remotePeerId || '?';
    console.log('[SEND]', remoteId, bytes.length);
    dc.send(bytes);
    dbgP2P('SEND ->', wire.type, { id: wire.id, to: wire.to || null });
    return true;
  } catch (e) {
    console.warn('send failed', e);
    return false;
  }
}

function broadcast(obj) {
  for (const [peerId, dc] of channelsByPeer.entries()) {
    sendOnChannel(dc, obj, peerId);
  }
}

function bumpVersion() {
  sharedState.version += 1;
}

function cloneLlmChat(raw) {
  if (!raw || typeof raw !== 'object') {
    return { busy: false, runPeerId: null, streamPartial: '', items: [] };
  }
  return {
    busy: !!raw.busy,
    runPeerId: raw.runPeerId || null,
    streamPartial: typeof raw.streamPartial === 'string' ? raw.streamPartial : '',
    items: Array.isArray(raw.items) ? raw.items.map(m => ({ ...m })) : []
  };
}

function mergeIncomingState(remote, opts = {}) {
  if (!remote || typeof remote !== 'object') return;
  const allowRelay = opts.allowRelay !== false;
  const remoteVersion = Number(remote.version || 0);
  const localVersion = Number(sharedState.version || 0);
  const preferRemote = remoteVersion >= localVersion;
  const mergedSubtasksById = new Map();
  for (const st of Array.isArray(sharedState.subtasks) ? sharedState.subtasks : []) {
    mergedSubtasksById.set(st.id, { ...st });
  }
  for (const st of Array.isArray(remote.subtasks) ? remote.subtasks : []) {
    const prev = mergedSubtasksById.get(st.id);
    if (!prev) {
      mergedSubtasksById.set(st.id, { ...st });
      continue;
    }
    // Preserve "done" if either side already finished.
    const done = prev.status === 'done' || st.status === 'done';
    mergedSubtasksById.set(st.id, {
      ...prev,
      ...(preferRemote ? st : prev),
      status: done ? 'done' : (preferRemote ? st.status : prev.status),
      result: done ? (st.result || prev.result || '') : (preferRemote ? st.result : prev.result)
    });
  }
  const mergedChat =
    remote.llmChat != null && typeof remote.llmChat === 'object'
      ? mergeLlmChatItems(sharedState.llmChat?.items, remote.llmChat.items, preferRemote)
      : cloneLlmChat(sharedState.llmChat);
  sharedState = {
    ...sharedState,
    ...(preferRemote ? remote : {}),
    version: Math.max(localVersion, remoteVersion),
    subtasks: Array.from(mergedSubtasksById.values()),
    generation: remote.generation
      ? { ...sharedState.generation, ...remote.generation }
      : sharedState.generation,
    llmChat: mergedChat
  };
  if (pendingGuestPrompt && (sharedState.llmChat.items || []).length > 0) {
    pendingGuestPrompt = null;
  }
  updatePeers();
  if (sharedState.generation.partialOutput) {
    setOutput(sharedState.generation.partialOutput);
  }
  refreshAskLlmDisplay();
  if (allowRelay) {
    relayMergedStateFromHost(opts.fromPeerId || null);
  }
}

/** Star topology: host fans out merged CRDT state so guests (no guest↔guest link) converge. */
function relayMergedStateFromHost(fromPeerId) {
  if (!P2PAgents.isLeader || !fromPeerId) return;
  if (fromPeerId === localPeerId) return;
  const snap = compactStateForWire(sharedState);
  for (const [pid, ch] of channelsByPeer.entries()) {
    if (!pid || pid === fromPeerId || !ch || ch.readyState !== 'open') continue;
    sendOnChannel(ch, { type: 'state', state: snap }, pid);
  }
}

/** @param {RTCDataChannel} dc */
function sendHello(dc) {
  sendOnChannel(dc, {
    type: 'hello',
    peerId: localPeerId,
    knownPeerIds: Array.from(P2PAgents.knownPeerIds),
    webgpu: localWebGpuLikely,
    authToken: sessionAuthToken || ''
  });
}

function pushFullStateOnDataChannel(dc) {
  if (!dc || dc.readyState !== 'open') return;
  const snap = compactStateForWire(sharedState);
  sendOnChannel(dc, { type: 'state', state: snap });
  console.log('[FULL SYNC SENT]', dc._remotePeerId || 'pending');
}

function broadcastState() {
  bumpVersion();
  const snap = compactStateForWire(sharedState);
  broadcast({ type: 'state', state: snap });
  console.log('[FULL SYNC SENT]', 'all_peers');
  saveCheckpoint();
}

function startSyncTimer() {
  if (syncTimer) clearInterval(syncTimer);
  syncTimer = setInterval(() => {
    runTransportHealthCheck();
    if (channelsByPeer.size === 0) return;
    bumpVersion();
    broadcast({ type: 'state', state: compactStateForWire(sharedState) });
  }, CONFIG.syncIntervalMs);
}

function runTransportHealthCheck() {
  if (channelsByPeer.size === 0) return;
  const now = Date.now();
  if (now - lastTransportHeartbeatAt < TRANSPORT_HEARTBEAT_MS) return;
  lastTransportHeartbeatAt = now;
  for (const [peerId, dc] of channelsByPeer.entries()) {
    if (!peerId || !dc) continue;
    if (dc.readyState !== 'open') {
      onTransportGone(peerId, 'not_open');
      continue;
    }
    const seenAt = peerStats.get(peerId)?.lastSeenAt || 0;
    if (seenAt && now - seenAt > TRANSPORT_STALE_MS) {
      log(`Transport heartbeat timeout from ${peerId.slice(0, 8)}…; dropping stale link.`);
      try {
        dc.close();
      } catch {
        /* ignore */
      }
      onTransportGone(peerId, 'stale_heartbeat');
      continue;
    }
    try {
      // Keep ping message in standard envelope via send helper.
      sendOnChannel(dc, {
        type: 'transport_ping',
        fromPeerId: localPeerId,
        sentAt: now
      }, peerId);
      pendingTransportPings.set(peerId, now);
    } catch {
      onTransportGone(peerId, 'ping_send_failed');
    }
  }
}

function waitForIceGatheringComplete(pc, timeoutMs = CONFIG.iceGatherTimeoutMs) {
  if (!pc || pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise(resolve => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      pc.removeEventListener('icegatheringstatechange', onChange);
      clearTimeout(timer);
      resolve();
    };
    const onChange = () => {
      if (pc.iceGatheringState === 'complete') finish();
    };
    const timer = setTimeout(finish, timeoutMs);
    pc.addEventListener('icegatheringstatechange', onChange);
  });
}

function closeSignalBus() {
  if (!signalBus) return;
  signalBus.onmessage = null;
  signalBus.close();
  signalBus = null;
}

function ensureSignalBus(roomId) {
  if (!roomId || typeof BroadcastChannel === 'undefined') return;
  const name = `southstack-p2p-signal-${roomId}`;
  if (signalBus && signalBus.name === name) return;
  closeSignalBus();
  signalBus = new BroadcastChannel(name);
  signalBus.onmessage = async ev => {
    const msg = ev?.data || {};
    if (!msg || msg.roomId !== roomId || msg.peerId === localPeerId) return;
    if (msg.type === 'offer' && msg.sdp) {
      latestOfferSdp = msg.sdp;
      const offerBox = document.getElementById('joinOffer');
      if (offerBox && !offerBox.value.trim()) offerBox.value = msg.sdp;
      log('Host text received automatically (same browser).');
      return;
    }
    if (msg.type === 'answer' && msg.sdp && P2PAgents.isLeader) {
      try {
        await completeHandshakeAnswer(msg.sdp);
        log('Guest reply applied automatically (same browser).');
      } catch (e) {
        log(`Could not apply guest reply automatically: ${e.message}`);
      }
      return;
    }
    if (msg.type === 'candidate' && msg.candidate) {
      const targetPc = pendingLeaderConnection || localConnection;
      if (!targetPc) return;
      try {
        await targetPc.addIceCandidate(msg.candidate);
        dbgP2P('BroadcastChannel ICE candidate applied');
      } catch (e) {
        dbgP2P('BroadcastChannel ICE candidate failed', String(e?.message || e));
      }
    }
  };
}

function postSignal(type, sdp, candidate = null) {
  if (!signalBus || !P2PAgents.roomId) return;
  signalBus.postMessage({
    type,
    sdp,
    candidate,
    roomId: P2PAgents.roomId,
    peerId: localPeerId
  });
}

// ---------- Optional HTTP signaling (run: python3 serve_with_signal.py) ----------
/** Live check — not cached, so a false result in one browser does not block another. */
async function isSignalServerAvailable() {
  try {
    const r = await fetch('/api/southstack/ping', { method: 'GET', cache: 'no-store' });
    return r.ok;
  } catch {
    return false;
  }
}

async function fetchSignalOfferNow(roomId) {
  try {
    const r = await fetch(`/api/southstack/offer?room=${encodeURIComponent(roomId)}`, {
      cache: 'no-store'
    });
    if (r.status === 204) return '';
    if (!r.ok) return '';
    const j = await r.json();
    const sdp = j.sdp;
    return sdp && String(sdp).length > 40 ? String(sdp) : '';
  } catch {
    return '';
  }
}

/** Fills #connDiagPanel with URLs this server thinks other devices should use. */
async function refreshLanHintPanel() {
  const el = document.getElementById('connDiagPanel');
  if (!el) return;
  el.innerHTML =
    '<strong style="color:#9fd4ff;">LAN connection check</strong><p class="small muted" style="margin-top:6px;">Checking…</p>';
  let hintTimer = null;
  try {
    const ac = new AbortController();
    hintTimer = setTimeout(() => ac.abort(), 10000);
    const r = await fetch('/api/southstack/lan-hint', { cache: 'no-store', signal: ac.signal });
    clearTimeout(hintTimer);
    hintTimer = null;
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    const urls = Array.isArray(j.urls) ? j.urls : [];
    const lis = urls.length
      ? urls.map(u => `<li style="margin:6px 0"><code style="user-select:all">${u}</code></li>`).join('')
      : '<li class="small">No LAN IP auto-detected — on the host run <code>ipconfig</code> (Windows) or check Network settings (Mac) and use that IPv4 with port <strong>' +
        (j.port || 8000) +
        '</strong>.</li>';
    const srvPort = j.port || 8000;
    const tabOrigin = window.location.origin;
    el.innerHTML = `<strong style="color:#9fd4ff;">Open on the other device (same Wi‑Fi)</strong>
      <p class="small" style="margin-top:8px;line-height:1.5;"><strong>This tab:</strong> <code style="user-select:all">${tabOrigin}</code></p>
      <ul style="margin:8px 0 0 1.1rem;">${lis}</ul>
      <p class="small" style="margin-top:12px;padding:10px;background:rgba(120,60,20,0.35);border-radius:8px;border:1px solid #8b5a2a;line-height:1.5;"><strong>Port must match.</strong> This server listens on <strong>:${srvPort}</strong>. If the phone shows <strong>:8001</strong> (or any other port) and you get <em>refused</em>, the server is not on that port. Either open <code>http://192.168.31.91:${srvPort}</code> on the phone, or start the host with <code>PORT=8001 python3 serve_with_signal.py</code> to listen on 8001.</p>
      <p class="small" style="margin-top:10px;line-height:1.45;"><strong>Also check:</strong> Firewall on the host for TCP <strong>${srvPort}</strong>. Phone on Wi‑Fi, not mobile data. IP <strong>192.168</strong>… not 191.168.</p>
      <button type="button" style="margin-top:10px;" onclick="refreshLanHintPanel()">Refresh LAN URLs</button>`;
  } catch {
    if (hintTimer != null) clearTimeout(hintTimer);
    el.innerHTML = `<strong style="color:#e8b060;">Could not read LAN hints</strong>
      <p class="small" style="margin-top:8px;">Start the app from <code>southstack-p2p</code> with:</p>
      <pre style="margin-top:8px;padding:10px;background:#111;border-radius:8px;font-size:12px;">python3 serve_with_signal.py</pre>
      <p class="small">Do not use <code>file://</code>. If you only run <code>python3 -m http.server</code>, there is no <code>/api/southstack/</code> — use <code>serve_with_signal.py</code> for LAN + auto WebRTC.</p>
      <button type="button" style="margin-top:8px;" onclick="refreshLanHintPanel()">Retry</button>`;
  }
}

async function apiPostOffer(roomId, sdp) {
  const r = await fetch('/api/southstack/offer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ room: roomId, sdp })
  });
  if (!r.ok) throw new Error(`POST offer HTTP ${r.status}`);
}

async function apiPostAnswer(roomId, sdp) {
  const r = await fetch('/api/southstack/answer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ room: roomId, sdp })
  });
  if (!r.ok) throw new Error(`POST answer HTTP ${r.status}`);
}

async function apiPostCandidate(roomId, candidate, toPeerId = '') {
  if (!candidate) return;
  try {
    await fetch('/api/southstack/candidate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        room: roomId,
        fromPeerId: localPeerId,
        toPeerId,
        candidate
      })
    });
  } catch {
    /* ignore */
  }
}

async function apiPollCandidates(roomId) {
  try {
    const r = await fetch(
      `/api/southstack/candidate?room=${encodeURIComponent(roomId)}&peer=${encodeURIComponent(localPeerId)}`,
      { cache: 'no-store' }
    );
    if (r.status === 204 || !r.ok) return [];
    const j = await r.json();
    return Array.isArray(j.candidates) ? j.candidates : [];
  } catch {
    return [];
  }
}

function startCandidatePolling(key, roomId, pc) {
  stopCandidatePolling(key);
  if (!roomId || !pc) return;
  const timer = setInterval(async () => {
    if (!P2PAgents.roomId || P2PAgents.roomId !== roomId) return;
    const list = await apiPollCandidates(roomId);
    for (const item of list) {
      const c = item?.candidate;
      if (!c) continue;
      try {
        await pc.addIceCandidate(c);
        dbgP2P('ICE candidate applied', { from: item.fromPeerId || null });
      } catch (e) {
        dbgP2P('ICE add failed', String(e?.message || e));
      }
    }
  }, 700);
  candidatePollers.set(key, timer);
}

function stopCandidatePolling(key) {
  const timer = candidatePollers.get(key);
  if (timer) clearInterval(timer);
  candidatePollers.delete(key);
}

function stopHostAnswerPolling() {
  if (hostAnswerPollTimer) {
    clearInterval(hostAnswerPollTimer);
    hostAnswerPollTimer = null;
  }
}

function startHostAnswerPolling() {
  stopHostAnswerPolling();
  const roomId = P2PAgents.roomId;
  if (!roomId) return;
  const startedAt = Date.now();
  const maxPollMs = 90 * 1000;
  hostAnswerPollTimer = setInterval(async () => {
    try {
      if (Date.now() - startedAt > maxPollMs) {
        stopHostAnswerPolling();
        log('Signaling: no guest answer yet (timed out). Ask guest to open invite and tap Join room.');
        return;
      }
      const r = await fetch(`/api/southstack/answer?room=${encodeURIComponent(roomId)}`, { cache: 'no-store' });
      if (r.status === 204) return;
      if (!r.ok) return;
      const j = await r.json();
      const sdp = j.sdp;
      if (sdp && typeof sdp === 'string' && sdp.length > 40) {
        stopHostAnswerPolling();
        const box = document.getElementById('answerSdp');
        if (box) box.value = sdp;
        await completeHandshakeAnswer(sdp);
        log('Signaling: guest answer applied automatically.');
      }
    } catch {
      /* ignore */
    }
  }, 1000);
}

async function pollSignalOfferUntil(roomId, maxMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    try {
      const r = await fetch(`/api/southstack/offer?room=${encodeURIComponent(roomId)}`, {
        cache: 'no-store'
      });
      if (r.status === 204) {
        await new Promise(res => setTimeout(res, 400));
        continue;
      }
      if (r.ok) {
        const j = await r.json();
        if (j.sdp && String(j.sdp).length > 40) return String(j.sdp);
      }
    } catch {
      /* ignore */
    }
    await new Promise(res => setTimeout(res, 400));
  }
  return null;
}

function guessLanIpViaWebRTC() {
  return new Promise(resolve => {
    const candidates = [];
    let settled = false;
    const pc = new RTCPeerConnection({ iceServers: [] });
    const done = () => {
      if (settled) return;
      settled = true;
      try {
        pc.close();
      } catch {
        /* ignore */
      }
      const priv = candidates.filter(
        ip =>
          ip &&
          !ip.startsWith('127.') &&
          ip !== '0.0.0.0' &&
          !ip.startsWith('169.254.')
      );
      const ip =
        priv.find(i => i.startsWith('192.168.')) ||
        priv.find(i => i.startsWith('10.')) ||
        priv.find(i => /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(i)) ||
        priv[0] ||
        null;
      resolve(ip);
    };
    const t = setTimeout(done, 3200);
    try {
      pc.createDataChannel('probe');
    } catch {
      clearTimeout(t);
      resolve(null);
      return;
    }
    pc.onicecandidate = e => {
      if (!e || !e.candidate) {
        if (e && e.candidate === null) {
          clearTimeout(t);
          setTimeout(done, 150);
        }
        return;
      }
      const c = e.candidate.candidate || '';
      const m = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/.exec(c);
      if (m && !candidates.includes(m[1])) candidates.push(m[1]);
    };
    pc.createOffer()
      .then(o => pc.setLocalDescription(o))
      .catch(() => {
        clearTimeout(t);
        done();
      });
  });
}

function showQrExpanded() {
  if (!getJoinLinkValue()) return;
  const wrap = document.getElementById('joinQrWrap');
  const btn = document.getElementById('joinQrBtn');
  updateJoinQr();
  if (wrap) wrap.style.display = 'flex';
  if (btn) btn.textContent = 'Hide QR code';
}

async function easyStartSessionAndShowQr() {
  const st = document.getElementById('easyConnectStatus');
  document.querySelectorAll('[data-easy-start]').forEach(b => {
    b.disabled = true;
  });
  if (st) st.textContent = 'Detecting LAN IP for phone link…';
  try {
    const el = document.getElementById('lanBaseUrl');
    if (el && !el.value.trim()) {
      const ip = await guessLanIpViaWebRTC();
      if (ip) {
        const pr = window.location.protocol || 'http:';
        let po = window.location.port;
        if (!po) po = pr === 'https:' ? '443' : '8000';
        el.value = `${pr}//${ip}:${po}`;
        applyLanBaseToInviteLink();
      }
    }
    if (st) st.textContent = 'Creating room and WebRTC offer…';
    await createRoom();
    const sig = await isSignalServerAvailable();
    if (st) {
      st.textContent = sig
        ? 'Ready. Guest: open the link or scan QR → tap Join room (SDP swaps automatically).'
        : 'Room ready. This server has no signaling API — use copy/paste SDP, or run python3 serve_with_signal.py and refresh.';
    }
    showQrExpanded();
  } catch (e) {
    if (st) st.textContent = `Error: ${e.message || e}`;
    log(`Easy start: ${e.message || e}`);
  } finally {
    document.querySelectorAll('[data-easy-start]').forEach(b => {
      b.disabled = false;
    });
  }
}

// ---------- WebLLM ----------
function onWebLlmInitProgress(report) {
  const pct =
    typeof report?.progress === 'number' && !Number.isNaN(report.progress)
      ? Math.round(report.progress * 100)
      : null;
  const sec = ((report?.timeElapsed || 0) / 1000).toFixed(0);
  const text = (report && report.text) || 'Loading model…';
  log(pct != null ? `${text} (${pct}%, ${sec}s)` : `${text} (${sec}s)`);
  if (engineInitUiTarget === 'ask') {
    const ban = document.getElementById('askLlmLoadBanner');
    if (ban) {
      ban.style.display = 'block';
      const detail = pct != null ? `${text} — ${pct}% · ${sec}s` : `${text} — ${sec}s`;
      ban.textContent = `Loading AI model (WebLLM)… ${detail}`;
    }
  }
}

function buildMlceEngineConfig(webllm) {
  const engineOptions = {
    initProgressCallback: onWebLlmInitProgress,
    logLevel: 'INFO',
    chatOpts: {
      max_gen_len: 768
    }
  };
  if (webllm.prebuiltAppConfig) {
    engineOptions.appConfig = { ...webllm.prebuiltAppConfig };
  }
  return engineOptions;
}

/** @returns {Promise<unknown>} */
function raceWithTimeoutFixed(promise, ms, timeoutMessage) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(timeoutMessage)), ms);
  });
  return Promise.race([
    promise.finally(() => {
      clearTimeout(timer);
    }),
    timeout
  ]);
}

function formatErrorLegacy(error) {
  if (!error) return 'Unknown error';
  if (typeof error === 'string') return error;
  if (error.message) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/** From unified southstack/: clear Cache Storage (helps recover from bad SW/model cache). */
async function clearSouthStackRuntimeCaches() {
  try {
    if (typeof caches !== 'undefined' && caches.keys) {
      const names = await caches.keys();
      await Promise.all(names.map(name => caches.delete(name)));
    }
  } catch (e) {
    console.warn('[SouthStack] Cache cleanup:', formatErrorLegacy(e));
  }
}

/** RAM hint (GB) for `SouthStack.getSystemStatus()` — same idea as legacy southstack/. */
async function checkRAMSouthStack() {
  try {
    if (navigator.deviceMemory) {
      const ramGB = navigator.deviceMemory;
      if (ramGB < CONFIG.minRAMGB) {
        console.warn(`[SouthStack] Low RAM: ${ramGB}GB (recommended ${CONFIG.minRAMGB}GB+)`);
      }
      return ramGB;
    }
    if (performance.memory) {
      return performance.memory.totalJSHeapSize / (1024 * 1024 * 1024);
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** Storage estimate for diagnostics (legacy southstack/). */
async function checkStorageQuotaSouthStack() {
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const estimate = await navigator.storage.estimate();
      return {
        usedBytes: estimate.usage,
        quotaBytes: estimate.quota,
        availableBytes: Math.max(0, estimate.quota - estimate.usage)
      };
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Legacy console `ask("prompt")` from southstack/ + southstack-demo: user message only, streamed to console.
 * Distinct from `promptCoding` / `consoleCodingPrompt` (those apply the coding-assistant system prompt).
 */
async function legacyConsoleAsk(prompt) {
  const text = String(prompt || '').trim();
  if (!text) {
    console.warn('[SouthStack] Usage: ask("your prompt")');
    return '';
  }
  console.log(`\n${'='.repeat(50)}\nPrompt: ${text}\n${'='.repeat(50)}`);
  const runOnce = async () => {
    await initEngine();
    if (!engine || !modelLoaded) {
      console.error('[SouthStack] Model not available.');
      return '';
    }
    const stream = await engine.chat.completions.create({
      messages: [{ role: 'user', content: text }],
      max_tokens: CONFIG.legacyMaxTokens,
      temperature: CONFIG.legacyTemperature,
      top_p: CONFIG.legacyTopP,
      stream: true
    });
    let full = '';
    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content || '';
      if (delta) {
        full += delta;
        console.log(delta);
      }
    }
    console.log(`\n${'-'.repeat(40)}\nResponse complete (${full.length} characters).`);
    return full;
  };
  try {
    return await runOnce();
  } catch (error) {
    const msg = String(error?.message || error || '');
    if (/memory|OOM|out of memory/i.test(msg)) {
      console.warn('[SouthStack] Memory error — resetting engine and retrying once…');
      engine = null;
      modelLoaded = false;
      engineInitInFlight = null;
      try {
        return await runOnce();
      } catch (e2) {
        console.error('[SouthStack] ask() failed:', formatErrorLegacy(e2));
        throw e2;
      }
    }
    console.error('[SouthStack] ask() failed:', formatErrorLegacy(error));
    throw error;
  }
}

async function initEngine() {
  if (modelLoaded && engine) return;
  if (!navigator.gpu) throw new Error(WEBGPU_UNAVAILABLE_MESSAGE);
  if (!engineInitInFlight) {
    engineInitInFlight = (async () => {
      try {
        ensureWebGPUAdapterCompat();
        let webllm;
        try {
          webllm = await import('https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.40/lib/index.js');
        } catch (impErr) {
          throw new Error(
            `Could not load WebLLM from CDN (${impErr?.message || impErr}). ` +
              'Use a normal internet connection the first time, or allow cdn.jsdelivr.net.'
          );
        }
        const engineOptions = buildMlceEngineConfig(webllm);
        let lastErr = null;
        const timeoutMin = Math.round(CONFIG.modelLoadTimeoutMs / 60000);
        for (const modelId of CONFIG.modelCandidates) {
          try {
            log(`Loading AI model… (${modelId})`);
            // #region agent log
            dbgLogP2p('H3', 'p2p/initEngine:beforeCreate', 'before CreateMLCEngine', { modelId });
            // #endregion
            const loadPromise = webllm.CreateMLCEngine(modelId, engineOptions);
            engine = await raceWithTimeoutFixed(
              loadPromise,
              CONFIG.modelLoadTimeoutMs,
              `Model load timed out after ${timeoutMin} minutes (network, WebGPU, or disk). ` +
                'Try stable Wi‑Fi, Chrome + WebGPU, or reload after cache fills.'
            );
            // #region agent log
            dbgLogP2p('H7', 'p2p/initEngine:afterCreate', 'CreateMLCEngine ok', { modelId });
            // #endregion
            modelLoaded = true;
            lastLoadedModelId = modelId;
            log(`AI model ready (${modelId}).`);
            return;
          } catch (err) {
            lastErr = err;
            // #region agent log
            dbgLogP2p('H4', 'p2p/initEngine:modelCatch', 'CreateMLCEngine failed', {
              modelId,
              message: String(err?.message || err)
            });
            // #endregion
            log(`This model did not load, trying another… (${modelId}): ${err?.message || err}`);
            engine = null;
            modelLoaded = false;
          }
        }
        throw new Error(`Failed to load model: ${lastErr?.message || 'no compatible model found'}`);
      } finally {
        engineInitInFlight = null;
      }
    })();
  }
  await engineInitInFlight;
}

// ---------- WebRTC ----------
function wireConnectionState(pc) {
  pc.onsignalingstatechange = () => {
    log(`Signaling: ${pc.signalingState}`);
    dbgP2P('RTC signalingState', pc.signalingState);
  };
  pc.onconnectionstatechange = () => {
    const s = pc.connectionState;
    log(`Connection: ${s}`);
    console.info('[SouthStack P2P] WebRTC connectionState:', s);
    dbgP2P('RTC connectionState', s);
    if (s === 'failed') {
      log('WebRTC connection failed — same Wi‑Fi? Try ?offline=1 on BOTH devices, or check firewall.');
      try {
        if (typeof pc.restartIce === 'function') {
          pc.restartIce();
          log('Attempting ICE restart after connection failure…');
        }
      } catch {
        /* ignore */
      }
      setRoomStatus(
        '<strong>WebRTC could not connect.</strong> Use the <strong>same Wi‑Fi</strong> as the host (not mobile data). Add <code>?offline=1</code> to the URL on <strong>both</strong> host and guest. Keep <code>serve_with_signal.py</code> running; then refresh and join again.'
      );
    }
  };
  pc.oniceconnectionstatechange = () => {
    const ice = pc.iceConnectionState;
    log(`ICE: ${ice}`);
    dbgP2P('RTC iceConnectionState', ice);
    if (ice === 'failed') {
      log('ICE failed — incomplete network path between devices.');
      try {
        if (typeof pc.restartIce === 'function') {
          pc.restartIce();
          log('Attempting ICE restart after ICE failure…');
        }
      } catch {
        /* ignore */
      }
    }
  };
}

function onTransportGone(peerId, reason = 'unknown') {
  if (!peerId || !channelsByPeer.has(peerId)) return;
  p2pNeedsFullResync = true;
  log(`A device left (${peerId.slice(0, 8)}…). Reason: ${reason}.`);
  if (reason === 'stale_heartbeat' || reason === 'ping_send_failed') {
    metricsState.transportDrops = (metricsState.transportDrops || 0) + 1;
  }
  const gone = peerId;
  channelsByPeer.delete(peerId);
  const pc = peerConnectionsByPeer.get(peerId);
  if (pc) {
    try {
      pc.close();
    } catch {}
  }
  peerConnectionsByPeer.delete(peerId);
  P2PAgents.knownPeerIds.delete(peerId);
  peerWebGpuByPeer.delete(peerId);
  authenticatedPeers.delete(peerId);
  pendingTransportPings.delete(peerId);
  for (const [messageId, pending] of pendingTaskAcks.entries()) {
    if (pending.assignee === peerId) {
      if (pending.timer) clearTimeout(pending.timer);
      pendingTaskAcks.delete(messageId);
    }
  }
  if (channelsByPeer.size === 0) {
    P2PAgents.knownPeerIds = new Set([localPeerId]);
    peerWebGpuByPeer.clear();
    peerWebGpuByPeer.set(localPeerId, localWebGpuLikely);
    authenticatedPeers.clear();
    authenticatedPeers.set(localPeerId, true);
  } else {
    P2PAgents.knownPeerIds.add(localPeerId);
  }
  applyLeader();
  const r = sharedState.llmChat.runPeerId;
  const noPeersLeft = channelsByPeer.size === 0;
  if (sharedState.llmChat.busy && r === gone) {
    sharedState.llmChat.busy = false;
    sharedState.llmChat.streamPartial = '';
    sharedState.llmChat.runPeerId = null;
    sharedState.llmChat.items.push({
      id: `drop_${Date.now()}`,
      role: 'assistant',
      fromPeerId: gone,
      content: noPeersLeft
        ? '[Other device went offline — this tab is alone (WebRTC link lost). Reconnect both sides with the same room code when the other machine is back. Chat above stays in this browser.]'
        : '[Interrupted: coordinator left mid-answer. Another device may be coordinator now — try Ask again when ready.]',
      at: Date.now()
    });
    bumpVersion();
    broadcastState();
    refreshAskLlmDisplay();
  }
  reassignOrphanSubtasks();
  void (async () => {
    await continueGenerationAfterFailover();
    await flushPendingSubtasksAfterFailover();
  })();
  updatePeers();
  if (channelsByPeer.size === 0 && P2PAgents.roomId) {
    stopCandidatePolling('pending-host');
    stopCandidatePolling('pending-join');
    setRoomStatus(
      `<strong>Not linked to another device.</strong> If the other machine closed or slept, this tab is alone — WebRTC needs both sides online (like a live call). When it returns, use the same room code and <strong>Join room</strong> / host <strong>New guest</strong>. Chat history stays in this browser (IndexedDB) until you clear site data.`
    );
    updateStatus('No peer link — reconnect to continue together.', 'disconnected');
    scheduleAutoReconnect('peer disconnected');
  }
}

async function createRoom() {
  P2PAgents.roomId = Math.random().toString(36).slice(2, 10);
  sessionAuthToken = newSessionAuthToken();
  authenticatedPeers.clear();
  authenticatedPeers.set(localPeerId, true);
  ensureSignalBus(P2PAgents.roomId);
  const rid = document.getElementById('roomId');
  if (rid) rid.value = P2PAgents.roomId;
  updateJoinLinkField(P2PAgents.roomId);
  setRoomStatus(`Room code: <strong>${P2PAgents.roomId}</strong><br>Share the invite link or code. Add one guest at a time: send them the long text, then paste their reply.`);
  try {
    const u = new URL(window.location.href);
    const loopback =
      u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]' || u.hostname === '::1';
    if (loopback && !getLanBaseOverride()) {
      log('Phone QR tip: set “LAN URL for phone” (your PC Wi‑Fi IP) and click Apply — or the QR opens 127.0.0.1 on the phone and fails.');
    }
  } catch {}

  await generateNextOffer();
  applyLeader();
  startSyncTimer();
  persistSessionSnapshot();
  log('Room ready. For each new guest, use “Copy text for guest”, then “Apply guest reply”, then “New guest” if needed.');
}

async function generateNextOffer() {
  dbgLog('pre-fix-v2', 'N1', 'main.js:generateNextOffer:entry', 'host generating next offer', {
    roomId: P2PAgents.roomId || null,
    hasPendingLeaderConnection: !!pendingLeaderConnection,
    knownPeers: P2PAgents.knownPeerIds.size
  });
  if (!P2PAgents.roomId) {
    setRoomStatus('Create a room or enter a room code first.');
    return;
  }
  if (pendingLeaderConnection) {
    try {
      pendingLeaderConnection.close();
    } catch {}
    pendingLeaderConnection = null;
  }

  const pc = new RTCPeerConnection({ iceServers: rtcIceServers() });
  pendingLeaderConnection = pc;
  // Do not assign localConnection here: host keeps one RTCPeerConnection per linked guest in
  // peerConnectionsByPeer; localConnection is for the joiner role only.
  wireConnectionState(pc);
  pc.onicecandidate = e => {
    if (!e?.candidate || !P2PAgents.roomId) return;
    const cand = e.candidate.toJSON ? e.candidate.toJSON() : e.candidate;
    postSignal('candidate', '', cand);
    void apiPostCandidate(P2PAgents.roomId, cand, '');
  };
  startCandidatePolling('pending-host', P2PAgents.roomId, pc);

  const dc = pc.createDataChannel('agents', { ordered: true });
  setupDataChannel(dc, 'pending-remote', pc);

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await waitForIceGatheringComplete(pc);
  const offerSdp = pc.localDescription?.sdp || offer.sdp || '';
  dbgLog('pre-fix-v2', 'N1', 'main.js:generateNextOffer:ready', 'offer ready', {
    roomId: P2PAgents.roomId,
    offerLen: offerSdp.length,
    signalingState: pc.signalingState,
    iceGatheringState: pc.iceGatheringState
  });

  try {
    localStorage.setItem(`southstack-p2p-offer-${P2PAgents.roomId}`, offerSdp);
  } catch {}
  latestOfferSdp = offerSdp;
  postSignal('offer', offerSdp);
  console.log('P2P_OFFER_SDP_START');
  console.log(offerSdp);
  console.log('P2P_OFFER_SDP_END');
  const mo = document.getElementById('myOffer');
  if (mo) {
    mo.innerHTML = `<textarea readonly rows="6" style="width:100%">${offerSdp}</textarea>`;
  }
  setRoomStatus(`Room code: <strong>${P2PAgents.roomId}</strong><br>Send “Copy text for guest” to one device. After you apply their reply, use “New guest” for the next device.`);
  log('New host text is ready for the next guest.');

  void (async () => {
    try {
      await apiPostOffer(P2PAgents.roomId, offerSdp);
      log('Signaling: offer posted — waiting for guest (auto).');
      startHostAnswerPolling();
    } catch (e) {
      log(`Signaling: could not post offer (${e.message}). Use manual SDP or run serve_with_signal.py.`);
    }
  })();
}

/**
 * Joiner: paste offer, or fetch it via /api/southstack when using serve_with_signal.py.
 */
/** Close a prior guest RTCPeerConnection; never tear down the host’s pending offer PC. */
function safeCloseJoinerPeerConnection() {
  if (!localConnection) return;
  if (pendingLeaderConnection && localConnection === pendingLeaderConnection) return;
  try {
    localConnection.close();
  } catch {
    /* ignore */
  }
  localConnection = null;
}

async function joinRoom(opts = {}) {
  const fromAuto = !!opts.fromAutoInvite;
  dbgLog('pre-fix-v2', 'N2', 'main.js:joinRoom:entry', 'join room called', {
    fromAutoInvite: fromAuto,
    roomInput: document.getElementById('roomId')?.value || ''
  });
  if (joinRoomInProgress) {
    log('Join already in progress…');
    return;
  }
  joinRoomInProgress = true;
  try {
    const ridEl = document.getElementById('roomId');
    const roomId = ridEl && typeof ridEl.value === 'string' ? ridEl.value.trim() : '';
    if (!sessionAuthToken) {
      const params = getInviteSearchParams();
      const tok = (params.get('auth') || '').trim();
      if (tok) sessionAuthToken = tok;
    }
    if (!roomId) {
      setRoomStatus('Enter a room code first, then tap Join room.');
      return;
    }
    if (roomId) {
      P2PAgents.roomId = roomId;
      ensureSignalBus(roomId);
      updateJoinLinkField(roomId);
    }
    const fromStorage = roomId ? localStorage.getItem(`southstack-p2p-offer-${roomId}`) || '' : '';
    const pasteEl = document.getElementById('joinOffer');
    const fromPaste = pasteEl && typeof pasteEl.value === 'string' ? pasteEl.value.trim() : '';
    let offerSdp = fromPaste || fromStorage || latestOfferSdp || '';
    dbgLog('pre-fix-v2', 'N2', 'main.js:joinRoom:offer-source', 'offer source lengths', {
      roomId,
      fromPasteLen: fromPaste.length,
      fromStorageLen: fromStorage.length,
      latestOfferLen: (latestOfferSdp || '').length,
      pickedLen: offerSdp.length
    });
    if (!offerSdp) {
      const quick = await fetchSignalOfferNow(roomId);
      if (quick) offerSdp = quick;
    }
    if (!offerSdp && (fromAuto || (await isSignalServerAvailable()))) {
      setRoomStatus('Waiting for host offer (signaling)…');
      offerSdp = await pollSignalOfferUntil(roomId, fromAuto ? 180000 : 90000);
      if (offerSdp && pasteEl) pasteEl.value = offerSdp;
    }
    if (!offerSdp && typeof prompt === 'function' && !fromAuto) {
      offerSdp = prompt('Paste the long text from the host:');
    }
    if (!offerSdp) {
      setRoomStatus(
        'No host offer yet. On the host use “Start session” (or Create room), then tap Join again — or paste SDP below.'
      );
      return;
    }

    const offerCrLf = sdpToCrLf(offerSdp);

    safeCloseJoinerPeerConnection();

    localConnection = new RTCPeerConnection({ iceServers: rtcIceServers() });
    wireConnectionState(localConnection);
    localConnection.onicecandidate = e => {
      if (!e?.candidate || !P2PAgents.roomId) return;
      const cand = e.candidate.toJSON ? e.candidate.toJSON() : e.candidate;
      postSignal('candidate', '', cand);
      void apiPostCandidate(P2PAgents.roomId, cand, '');
    };
    startCandidatePolling('pending-join', roomId, localConnection);

    localConnection.ondatachannel = e => {
      setupDataChannel(e.channel, 'pending-remote', localConnection);
    };

    await localConnection.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: offerCrLf }));
    dbgLog('pre-fix-v2', 'N2', 'main.js:joinRoom:remote-set', 'remote offer applied', {
      roomId,
      signalingState: localConnection.signalingState
    });
    const answer = await localConnection.createAnswer();
    await localConnection.setLocalDescription(answer);
    await waitForIceGatheringComplete(localConnection);

    const answerSdp = localConnection.localDescription?.sdp || answer.sdp || '';
    dbgLog('pre-fix-v2', 'N2', 'main.js:joinRoom:answer-ready', 'answer generated', {
      roomId,
      answerLen: answerSdp.length,
      signalingState: localConnection.signalingState
    });
    postSignal('answer', answerSdp);
    console.log('P2P_ANSWER_SDP_START');
    console.log(answerSdp);
    console.log('P2P_ANSWER_SDP_END');
    const ja = document.getElementById('joinerAnswer');
    if (ja) ja.value = answerSdp || '';
    let posted = false;
    try {
      await apiPostAnswer(roomId, answerSdp);
      posted = true;
      log('Signaling: answer sent to host.');
      setRoomStatus(`Joined room <strong>${roomId}</strong> — host should connect automatically.`);
    } catch (e) {
      log(`Signaling: answer upload failed (${e.message}). Copy answer to host manually.`);
    }
    if (!posted) {
      setRoomStatus(
        `Joined room <strong>${roomId}</strong>. Copy your reply and send it to the host.${signalBus ? ' (Sent automatically in this browser.)' : ''}`
      );
      log('Copy your reply and give it to the host.');
    }
    if (typeof prompt === 'function' && !fromAuto && !posted) {
      prompt('Your reply for the host (copy this):', answerSdp);
    }

    void initEngine().catch(e => {
      log(`AI did not start on this device (${e.message}). You can still connect; another device may run the AI.`);
    });

    startSyncTimer();
    scheduleGuestLinkWatchdog();
    persistSessionSnapshot();
    cancelAutoReconnect();
  } finally {
    joinRoomInProgress = false;
  }
}

/** Leader must call after receiving joiner's Answer */
async function completeHandshakeAnswer(answerSdp) {
  stopHostAnswerPolling();
  if (!answerSdp) return;
  const targetPc = pendingLeaderConnection || localConnection;
  dbgLog('pre-fix-v2', 'N3', 'main.js:completeHandshakeAnswer:entry', 'host applying guest answer', {
    answerLen: answerSdp.length,
    hasPendingLeaderConnection: !!pendingLeaderConnection,
    hasLocalConnection: !!localConnection,
    targetSignalingState: targetPc ? targetPc.signalingState : 'none'
  });
  if (!targetPc) {
    setRoomStatus('No waiting connection from a guest. Use “New guest” on the host first.');
    return;
  }
  const answerCrLf = sdpToCrLf(answerSdp);
  await targetPc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: answerCrLf }));
  dbgLog('pre-fix-v2', 'N3', 'main.js:completeHandshakeAnswer:applied', 'guest answer applied', {
    targetSignalingState: targetPc.signalingState,
    targetConnectionState: targetPc.connectionState
  });
  if (pendingLeaderConnection === targetPc) {
    pendingLeaderConnection = null;
    stopCandidatePolling('pending-host');
  }
  setRoomStatus(`Guest reply applied for room <strong>${P2PAgents.roomId || 'unknown'}</strong>. Finishing connection…`);
  log('Guest reply applied.');
}

function setupDataChannel(dc, remoteKey, pc = null) {
  dc._pc = pc || null;
  dc._remotePeerId = remoteKey && remoteKey !== 'pending-remote' ? remoteKey : null;
  if (dc._pc) {
    dc._pc.addEventListener('connectionstatechange', () => {
      dbgLog('pre-fix-v2', 'N4', 'main.js:pc:connectionstatechange', 'peer connection state changed', {
        state: dc._pc.connectionState,
        remotePeerId: dc._remotePeerId || null
      });
    });
  }
  dc.onopen = () => {
    dbgLog('pre-fix-v2', 'N5', 'main.js:datachannel:onopen', 'data channel open', {
      remotePeerId: dc._remotePeerId || null,
      readyState: dc.readyState
    });
    clearP2PLinkWatchdog();
    cancelAutoReconnect();
    reconnectAttempt = 0;
    log('Devices are now linked.');
    updateStatus('Connected. Devices can share work.', 'connected');
    setRoomStatus(`Connected in room <strong>${P2PAgents.roomId || 'unknown'}</strong> — ${P2PAgents.knownPeerIds.size} device(s).`);
    sendHello(dc);
    if (p2pNeedsFullResync) {
      try {
        pushFullStateOnDataChannel(dc);
        p2pNeedsFullResync = false;
        console.log('[FULL SYNC SENT/APPLIED]', dc._remotePeerId || 'pending');
      } catch {
        /* ignore */
      }
    }
    stopCandidatePolling('pending-join');
    startSyncTimer();
    persistSessionSnapshot();
  };
  dc.onmessage = async e => {
    const remoteId = dc._remotePeerId || '?';
    if (typeof e.data === 'string') {
      console.log('[RECV]', remoteId, e.data.length);
    } else if (e.data && typeof e.data === 'object' && typeof e.data.byteLength === 'number') {
      console.log('[RECV]', remoteId, e.data.byteLength);
    } else {
      console.log('[RECV]', remoteId, 0);
    }
    let raw;
    try {
      raw = JSON.parse(e.data);
    } catch {
      console.log('[DROP]', 'json_parse_failed');
      return;
    }
    const msg = normalizeIncomingMessage(raw);
    if (!msg || !msg.type) {
      dbgP2P('RECV malformed', raw);
      console.log('[DROP]', 'normalize_failed');
      return;
    }
    console.log('[PARSED FRAME]', msg.type);
    dbgP2P('RECV <-', msg.type, { id: msg.id || null, from: msg.from || null });
    // Generic ACK for all envelope messages with ids (except ACK itself).
    if (msg.id && msg.type !== 'ack') {
      sendOnChannel(dc, { type: 'ack', ackedId: msg.id }, msg.from || dc._remotePeerId || null);
    }
    await handleMessage(msg, dc);
  };
  dc.onclose = () => {
    dbgLog('pre-fix-v2', 'N5', 'main.js:datachannel:onclose', 'data channel closed', {
      remotePeerId: dc._remotePeerId || null,
      readyState: dc.readyState
    });
    log('Link to another device closed.');
    if (dc._remotePeerId) {
      onTransportGone(dc._remotePeerId, 'channel_close');
    } else if (pendingLeaderConnection && dc._pc === pendingLeaderConnection) {
      try {
        pendingLeaderConnection.close();
      } catch {
        /* ignore */
      }
      pendingLeaderConnection = null;
      log('Pending guest link closed before devices exchanged IDs.');
    }
  };

  if (remoteKey && remoteKey !== 'pending-remote') {
    channelsByPeer.set(remoteKey, dc);
    if (dc._pc) {
      peerConnectionsByPeer.set(remoteKey, dc._pc);
    }
  }
}

// ---------- Message handling ----------
async function handleMessage(msg, dc) {
  if (!msg || !msg.type) return;
  const remotePeerId = dc?._remotePeerId || msg?.peerId || msg?.fromPeerId || null;
  if (remotePeerId) touchPeerStat(remotePeerId);
  const isHandshakeMsg = msg?.type === 'hello' || msg?.type === 'hello_ack';
  if (!isHandshakeMsg && remotePeerId && sessionAuthToken) {
    if (!authenticatedPeers.get(remotePeerId)) {
      log(`Rejected unauthenticated message from ${String(remotePeerId).slice(0, 8)}…`);
      return;
    }
  }
  const fromLeaderOnly = new Set(['subtask', 'request_continue', 'heartbeat']);
  if (remotePeerId && fromLeaderOnly.has(msg?.type)) {
    if (P2PAgents.leaderId && remotePeerId !== P2PAgents.leaderId) {
      console.log('[DROP]', `unauthorized_${msg.type}_not_leader`);
      log(`Rejected unauthorized ${msg.type} from ${String(remotePeerId).slice(0, 8)}…`);
      return;
    }
  }
  switch (msg.type) {
    case 'ack':
      dbgP2P('ACK <-', msg.ackedId || null, { from: remotePeerId || msg.from || null });
      break;
    case 'heartbeat': {
      const hostSender = remotePeerId || msg.from || null;
      if (!hostSender || hostSender !== P2PAgents.leaderId) break;
      lastHostHeartbeatAt = Date.now();
      dbgP2P('[HEARTBEAT] received', { from: hostSender });
      {
        const n = Date.now();
        if (n - lastHeartbeatPublicLogAt > 12000) {
          lastHeartbeatPublicLogAt = n;
          console.info('[HEARTBEAT] received');
        }
      }
      break;
    }
    case 'hello': {
      clearP2PLinkWatchdog();
      const pid = msg.peerId;
      if (!pid) break;
      const token = String(msg.authToken || '').trim();
      if (sessionAuthToken && token && token !== sessionAuthToken) {
        log(`Rejected peer ${pid.slice(0, 8)}… due to auth token mismatch.`);
        break;
      }
      if (sessionAuthToken && !token) {
        log(`Rejected peer ${pid.slice(0, 8)}… without auth token.`);
        break;
      }
      authenticatedPeers.set(pid, true);
      peerWebGpuByPeer.set(pid, msg.webgpu === true);
      touchPeerStat(pid, { webgpu: msg.webgpu === true });
      (msg.knownPeerIds || []).forEach(id => P2PAgents.knownPeerIds.add(id));
      P2PAgents.knownPeerIds.add(pid);
      dc._remotePeerId = pid;
      channelsByPeer.set(pid, dc);
      if (dc._pc) {
        peerConnectionsByPeer.set(pid, dc._pc);
      }
      applyLeader();
      broadcast({
        type: 'hello_ack',
        peerId: localPeerId,
        knownPeerIds: Array.from(P2PAgents.knownPeerIds),
        webgpu: localWebGpuLikely,
        authToken: sessionAuthToken || ''
      });
      updatePeers();
      if (P2PAgents.isLeader) {
        try {
          broadcastState();
        } catch {
          /* ignore */
        }
      }
      break;
    }
    case 'hello_ack': {
      clearP2PLinkWatchdog();
      const token = String(msg.authToken || '').trim();
      if (sessionAuthToken && token && token !== sessionAuthToken) {
        log('Rejected hello_ack due to auth token mismatch.');
        break;
      }
      if (msg.peerId) authenticatedPeers.set(msg.peerId, true);
      (msg.knownPeerIds || []).forEach(id => P2PAgents.knownPeerIds.add(id));
      if (msg.peerId) {
        P2PAgents.knownPeerIds.add(msg.peerId);
        if (msg.webgpu === true || msg.webgpu === false) {
          peerWebGpuByPeer.set(msg.peerId, msg.webgpu);
          touchPeerStat(msg.peerId, { webgpu: msg.webgpu === true });
        }
      }
      applyLeader();
      updatePeers();
      break;
    }
    case 'transport_ping': {
      if (!remotePeerId || dc?.readyState !== 'open') break;
      sendOnChannel(dc, {
        type: 'transport_pong',
        fromPeerId: localPeerId,
        echoSentAt: Number(msg.sentAt) || Date.now()
      }, remotePeerId);
      break;
    }
    case 'transport_pong': {
      if (!remotePeerId) break;
      const sentAt = pendingTransportPings.get(remotePeerId);
      pendingTransportPings.delete(remotePeerId);
      if (!sentAt) break;
      const rtt = Math.max(1, Date.now() - sentAt);
      const stat = peerStats.get(remotePeerId) || { rttMs: TASK_ACK_TIMEOUT_MS };
      touchPeerStat(remotePeerId, {
        rttMs: Math.round((Number(stat.rttMs || TASK_ACK_TIMEOUT_MS) * 0.7) + (rtt * 0.3))
      });
      break;
    }
    case 'state': {
      const st = msg.state;
      if (!st || typeof st !== 'object') {
        console.log('[DROP]', 'state_missing_payload');
        break;
      }
      console.log('[APPLY]', remotePeerId || '?', JSON.stringify(st).length);
      mergeIncomingState(st, { fromPeerId: remotePeerId || null });
      break;
    }
    case 'token':
    case 'checkpoint': {
      if (msg.generation) {
        sharedState.generation = { ...sharedState.generation, ...msg.generation };
      }
      const g2 = sharedState.generation;
      const out =
        g2.subtaskStream != null && typeof g2.partialOutput === 'string'
          ? g2.partialOutput
          : msg.partialOutput != null
            ? msg.partialOutput
            : g2.partialOutput;
      if (out != null) {
        sharedState.generation.partialOutput = out;
        sharedState.generation.lastChunkAt = Date.now();
        setOutput(out);
      }
      await saveCheckpoint();
      break;
    }
    case 'subtask': {
      // Leader never receives their own delegated messages (only workers run incoming subtasks)
      if (P2PAgents.isLeader) break;
      const fromPeerId = dc?._remotePeerId || msg.fromPeerId || null;
      if (msg.messageId && fromPeerId && dc?.readyState === 'open') {
        sendOnChannel(dc, {
          type: 'subtask_ack',
          messageId: msg.messageId,
          subtaskId: msg.subtaskId,
          fromPeerId: localPeerId,
          at: Date.now()
        }, fromPeerId);
      }
      const stableExecId = `${msg.taskId || sharedState.taskId || 'na'}:${msg.subtaskId}`;
      if (executedTasks.has(stableExecId)) {
        const cached = completedSubtaskCache.get(msg.subtaskId) || '';
        if (fromPeerId && dc?.readyState === 'open') {
          sendOnChannel(dc, {
            type: 'subtask_result',
            taskId: msg.taskId || 'na',
            subtaskId: msg.subtaskId,
            result: cached,
            fromPeerId: localPeerId
          }, fromPeerId);
        }
        break;
      }
      if (msg.messageId && seenTaskMessageIds.has(msg.messageId)) {
        const cached = completedSubtaskCache.get(msg.subtaskId);
        if (cached && fromPeerId && dc?.readyState === 'open') {
          sendOnChannel(dc, {
            type: 'subtask_result',
            taskId: msg.taskId || 'na',
            subtaskId: msg.subtaskId,
            result: cached,
            fromPeerId: localPeerId
          }, fromPeerId);
        }
        break;
      }
      if (msg.messageId) seenTaskMessageIds.add(msg.messageId);
      executedTasks.add(stableExecId);
      await runSubtaskRemote(msg);
      break;
    }
    case 'subtask_ack': {
      if (!P2PAgents.isLeader) break;
      const id = msg.messageId;
      const pending = id ? pendingTaskAcks.get(id) : null;
      if (!pending) break;
      pending.acked = true;
      if (pending.timer) clearTimeout(pending.timer);
      pendingTaskAcks.delete(id);
      const peerId = msg.fromPeerId || null;
      if (peerId) {
        const stat = peerStats.get(peerId) || { rttMs: TASK_ACK_TIMEOUT_MS, inflight: 0, done: 0, fail: 0 };
        const rtt = Date.now() - (pending.startedAt || Date.now());
        touchPeerStat(peerId, {
          rttMs: Math.round((stat.rttMs * 0.7) + (Math.max(1, rtt) * 0.3))
        });
      }
      break;
    }
    case 'subtask_result':
      if (P2PAgents.isLeader && msg.subtaskId != null) {
        if (msg.fromPeerId) {
          touchPeerStat(msg.fromPeerId, {
            done: (peerStats.get(msg.fromPeerId)?.done || 0) + 1
          });
        }
        applySubtaskResult(msg.subtaskId, msg.result);
      }
      break;
    case 'request_continue':
      if (P2PAgents.isLeader) {
        await continueGenerationAfterFailover();
      }
      break;
    case 'llm_ask': {
      if (!P2PAgents.isLeader) break;
      const prompt = String(msg.prompt || '').trim();
      if (!prompt) break;
      const fromPeer = msg.fromPeerId || localPeerId;
      void enqueueLeaderLlm(() => runSharedLlmOnLeader(prompt, fromPeer));
      break;
    }
    case 'llm_stop': {
      if (!P2PAgents.isLeader) break;
      if (typeof activeSharedAskStop === 'function') {
        activeSharedAskStop({ byPeerId: msg.fromPeerId || null });
      } else if (sharedState.llmChat.busy) {
        // Safety valve: keep partial output and write an explicit stopped assistant message.
        if (recoverSharedAskAsStopped(msg.fromPeerId || null)) {
          bumpVersion();
          broadcast({ type: 'llm_shared_done', llmChat: cloneLlmChat(sharedState.llmChat) });
          broadcastState();
          refreshAskLlmDisplay();
        }
      }
      break;
    }
    case 'llm_shared_token': {
      if (P2PAgents.isLeader) break;
      pendingGuestPrompt = null;
      sharedState.llmChat.streamPartial = typeof msg.partial === 'string' ? msg.partial : '';
      sharedState.llmChat.busy = true;
      if (msg.fromPeerId) sharedState.llmChat.runPeerId = msg.fromPeerId;
      refreshAskLlmDisplay();
      break;
    }
    case 'llm_shared_done': {
      pendingGuestPrompt = null;
      if (msg.llmChat) sharedState.llmChat = cloneLlmChat(msg.llmChat);
      bumpVersion();
      refreshAskLlmDisplay();
      await saveCheckpoint();
      break;
    }
    case 'coordinator_elected': {
      handleCoordinatorElection(msg);
      break;
    }
    default:
      break;
  }
}

function applySubtaskResult(subtaskId, result) {
  const st = sharedState.subtasks.find(s => s.id === subtaskId);
  if (st && st.status === 'done' && st.result === result) {
    notifySubtaskDone(subtaskId);
    return;
  }
  if (st) {
    st.status = 'done';
    st.result = result;
    if (st.assignedTo) {
      ensurePeerMetric(st.assignedTo);
      metricsState.peerUtilization[st.assignedTo].completed += 1;
    }
    if (!String(result || '').trim()) {
      noteQuality(`Subtask ${subtaskId} produced empty output.`);
    } else if (String(result).length < 40) {
      noteQuality(`Subtask ${subtaskId} produced short output (${String(result).length} chars).`);
    }
  }
  P2PAgents.results.push(result || '');
  bumpVersion();
  broadcastState();
  appendOutput(`

--- subtask ${subtaskId} ---

${result || ''}`);
  finalizeIfAllSubtasksDone();
  notifySubtaskDone(subtaskId);
}

function finalizeIfAllSubtasksDone() {
  if (!P2PAgents.isLeader) return;
  if (!sharedState.subtasks.length) return;
  const allDone = sharedState.subtasks.every(s => s.status === 'done');
  if (!allDone) return;
  sharedState.status = 'done';
  sharedState.generation.phase = 'idle';
  sharedState.generation.streaming = false;
  if (metricsState.failures === 0) {
    noteQuality('All subtasks completed without transport failure.');
  } else {
    noteQuality(`Completed with ${metricsState.failures} transport-level failure(s) handled by retry/fallback.`);
  }
  finalizeMetricsAndPersist();
  const utilSummary = Object.entries(metricsState.peerUtilization || {})
    .map(([pid, m]) => `${String(pid).slice(0, 8)}… a:${m.assigned || 0} c:${m.completed || 0} f:${m.failed || 0}`)
    .join(' | ');
  if (utilSummary) {
    log(`Peer utilization: ${utilSummary}`);
  }
  bumpVersion();
  broadcastState();
  log('All parts of the job are finished.');
}

function reassignOrphanSubtasks() {
  for (const st of sharedState.subtasks) {
    if (st.status === 'running' && st.assignedTo && !isPeerReachableForWork(st.assignedTo)) {
      st.status = 'pending';
      st.assignedTo = null;
    }
  }
  if (P2PAgents.isLeader) {
    for (const st of sharedState.subtasks) {
      if (st.status === 'pending') {
        st.assignedTo = chooseAssigneeForSubtask();
        st.status = 'running';
      }
    }
  }
  bumpVersion();
  broadcastState();
}

/** After leader failover: run subtasks that are ours but not completed */
async function flushPendingSubtasksAfterFailover() {
  if (!P2PAgents.isLeader) return;
  if (!sharedState.subtasks.length) return;
  await initEngine();
  for (const st of sharedState.subtasks) {
    if (st.status === 'done') continue;
    if (!st.assignedTo || !isPeerReachableForWork(st.assignedTo)) {
      st.assignedTo = chooseAssigneeForSubtask();
    }
    if (st.assignedTo === localPeerId) {
      await runSubtaskRemote({ taskId: sharedState.taskId || 'na', subtaskId: st.id, payload: st.text });
      continue;
    }
    const ok = await sendSubtaskWithRetry(st, st.assignedTo);
    if (!ok) {
      st.assignedTo = localPeerId;
      await runSubtaskRemote({ taskId: sharedState.taskId || 'na', subtaskId: st.id, payload: st.text });
      continue;
    }
    await waitForSubtaskDone(st.id, 360000);
  }
}

function parseSubtasksFromPlanText(planText) {
  try {
    let subtasksRaw = planText.trim();
    const arrMatch = subtasksRaw.match(/\[[\s\S]*\]/);
    if (arrMatch) subtasksRaw = arrMatch[0];
    const subtasks = JSON.parse(subtasksRaw);
    if (!Array.isArray(subtasks)) return null;
    return subtasks.map((t, i) => ({
      id: i,
      text: typeof t === 'string' ? t : String(t),
      assignedTo: null,
      status: 'pending'
    }));
  } catch {
    return null;
  }
}

function isDebugWorkflowPrompt(task) {
  const t = String(task || '').toLowerCase();
  return /\b(debug|bug|failing test|stack trace|exception|race condition|regression)\b/.test(t);
}

function buildDebugSubtasks(task) {
  const base = String(task || '').trim();
  return [
    {
      id: 0,
      text: `[analyzer] Debug stage 1/4: Reproduce and localize the issue from this report. Return likely files/functions and a minimal reproduction.\n\n${base}`,
      assignedTo: null,
      status: 'pending'
    },
    {
      id: 1,
      text: `[analyzer] Debug stage 2/4: Perform root-cause analysis. Return concise reasoning, probable fault path, and confidence score.\n\n${base}`,
      assignedTo: null,
      status: 'pending'
    },
    {
      id: 2,
      text: `[fixer] Debug stage 3/4: Propose a patch. Return code-only fix with minimal side effects.\n\n${base}`,
      assignedTo: null,
      status: 'pending'
    },
    {
      id: 3,
      text: `[fixer] Debug stage 4/4: Design regression checks for the proposed fix. Return test cases and pass/fail criteria.\n\n${base}`,
      assignedTo: null,
      status: 'pending'
    }
  ];
}

async function delegateSubtasksFromState() {
  const jobs = [];
  metricsState.subtaskCount = sharedState.subtasks.length;
  for (const st of sharedState.subtasks) {
    const assignee = chooseAssigneeForSubtask();
    st.assignedTo = assignee;
    st.status = 'running';
    ensurePeerMetric(assignee);
    metricsState.peerUtilization[assignee].assigned += assignee === localPeerId ? 1 : 0;
    if (assignee === localPeerId) {
      jobs.push(runSubtaskRemote({ taskId: sharedState.taskId || 'na', subtaskId: st.id, payload: st.text }));
      continue;
    }
    jobs.push(
      (async () => {
        const ok = await sendSubtaskWithRetry(st, assignee);
        if (ok) {
          await waitForSubtaskDone(st.id, 360000);
          return;
        }
        log(`Subtask ${st.id} fallback to local execution after retries.`);
        st.assignedTo = localPeerId;
        await runSubtaskRemote({ taskId: sharedState.taskId || 'na', subtaskId: st.id, payload: st.text });
      })()
    );
  }
  await Promise.all(jobs);
  log('Subtasks finished with load-aware parallel scheduling.');
}

async function continueGenerationAfterFailover() {
  if (!P2PAgents.isLeader || !modelLoaded) return;
  const g = sharedState.generation;
  if (sharedState.status === 'done' || sharedState.status === 'error') return;
  const planOrMain =
    g.phase === 'plan_stream' ||
    g.phase === 'main_stream' ||
    sharedState.status === 'planning';
  if (!planOrMain) return;
  if (!g.streaming && !(g.partialOutput || '').length) return;

  await initEngine();
  const base = sharedState.originalPrompt || '';
  const partial = g.partialOutput || '';
  const wasPlan = g.phase === 'plan_stream' || sharedState.status === 'planning';
  const planCtx = sharedState.planPrompt || base;
  const continuation = wasPlan
    ? `${planCtx}

Continue from the last character only. Output ONLY valid JSON array text.

${partial}`
    : `${base}

(Continue from previous assistant output exactly where it left off.)

${partial}`;

  g.phase = wasPlan ? 'plan_stream' : 'main_stream';
  g.streaming = true;
  bumpVersion();
  broadcastState();

  try {
    const stream = await engine.chat.completions.create({
      messages: [{ role: 'user', content: continuation }],
      max_tokens: 1024,
      stream: true,
      temperature: 0.2
    });

    let acc = partial;
    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content || '';
      if (!delta) continue;
      acc += delta;
      g.partialOutput = acc;
      appendOutput(delta);
      broadcast({
        type: 'token',
        partialOutput: acc,
        generation: { phase: g.phase, streaming: true, partialOutput: acc }
      });
      await saveCheckpoint();
    }
    g.streaming = false;
    g.phase = 'idle';

    if (wasPlan) {
      const parsed = parseSubtasksFromPlanText(acc);
      if (parsed && parsed.length) {
        sharedState.subtasks = parsed;
        sharedState.status = 'running';
        sharedState.generation.phase = 'delegating';
        bumpVersion();
        broadcastState();
        await delegateSubtasksFromState();
      } else {
        sharedState.status = 'error';
        log('Could not read the plan after a device reconnected.');
      }
    } else {
      sharedState.status = sharedState.subtasks.length ? 'running' : 'done';
    }
    bumpVersion();
    broadcastState();
    log('Continuing after another device helped out.');
  } catch (e) {
    log(`Could not continue: ${e.message}`);
    sharedState.status = 'error';
    broadcastState();
  }
}

async function runSubtaskRemote(msg) {
  await initEngine();
  const subId = msg.subtaskId;
  const task = msg.payload;
  const taskType = msg.taskType || inferTaskType(task);
  const g = sharedState.generation;
  g.phase = `subtask_${subId}`;
  g.streaming = true;
  let acc = '';

  let userPrompt = `Complete this coding subtask.\n\n${task}`;
  if (taskType === 'analyze') {
    userPrompt =
      `You are an analyzer agent. Return STRICT JSON only with this shape:\n` +
      `{"summary":"...","likely_files":["..."],"root_cause":"...","confidence":0.0,"repro_steps":["..."]}\n\n` +
      `${task}`;
  } else if (taskType === 'fix') {
    userPrompt = `You are a fixer agent. Return ONLY code (no markdown, no explanation).\n\n${task}`;
  }

  const stream = await engine.chat.completions.create({
    messages: [
      {
        role: 'user',
        content: userPrompt
      }
    ],
    max_tokens: 1024,
    stream: true,
    temperature: 0.2
  });

  for await (const chunk of stream) {
    const delta = chunk.choices?.[0]?.delta?.content || '';
    if (!delta) continue;
    acc += delta;
    g.partialOutput = acc;
    const gen = { ...g, partialOutput: acc, subtaskStream: subId, streaming: true };
    broadcast({
      type: 'token',
      partialOutput: acc,
      generation: gen
    });
    broadcast({
      type: 'checkpoint',
      partialOutput: acc,
      generation: { ...gen, subtaskPartial: acc, subtaskId: subId }
    });
  }

  g.streaming = false;
  completedSubtaskCache.set(subId, acc);
  broadcast({
    type: 'subtask_result',
    taskId: msg.taskId || sharedState.taskId || 'na',
    subtaskId: subId,
    result: acc,
    fromPeerId: localPeerId
  });
  if (P2PAgents.isLeader) {
    applySubtaskResult(subId, acc);
  }
  await saveCheckpoint();
}

// ---------- Leader task flow ----------
async function assignTask() {
  if (!P2PAgents.isLeader) {
    log(
      'Only the host can start a shared job. On your PC, find the device marked (host) under Devices in this room — start the job there.'
    );
    return;
  }
  const taskEl = document.getElementById('taskInput');
  const task = taskEl ? taskEl.value.trim() : '';
  if (!task) return;
  stopSpeaking();
  if (voiceListening) stopVoiceListening(false);

  await initEngine();

  sharedState.taskId = `t_${Date.now()}`;
  resetMetrics(sharedState.taskId);
  sharedState.originalPrompt = task;
  sharedState.status = 'planning';
  sharedState.subtasks = [];
  sharedState.generation = {
    phase: 'plan_stream',
    partialOutput: '',
    streaming: true,
    lastChunkAt: Date.now()
  };
  const planPrompt = `Break this coding task into 2-4 short parallel subtasks. Reply with ONLY a JSON array of strings (subtask descriptions), no markdown:\n${task}`;
  sharedState.planPrompt = planPrompt;
  setOutput('');
  bumpVersion();
  broadcastState();

  try {
    if (task.length > LOCAL_CONTEXT_MAX_CHARS) {
      sharedState.subtasks = buildContextRoutedSubtasks(task);
      sharedState.status = 'running';
      sharedState.generation.phase = 'delegating';
      sharedState.generation.streaming = false;
      sharedState.generation.partialOutput = `[large-context mode: ${sharedState.subtasks.length} shards routed across peers]`;
      bumpVersion();
      broadcastState();
      log(
        `Large context detected (${task.length} chars). Applied chunking and distributed shard routing across peers.`
      );
      await delegateSubtasksFromState();
      return;
    }

    if (isDebugWorkflowPrompt(task)) {
      sharedState.subtasks = buildDebugSubtasks(task);
      sharedState.status = 'running';
      sharedState.generation.phase = 'delegating';
      sharedState.generation.streaming = false;
      sharedState.generation.partialOutput = '[debug pipeline: reproduce, analyze, patch, verify]';
      bumpVersion();
      broadcastState();
      log('Debug workflow detected. Running distributed reproduce/analyze/patch/verify pipeline.');
      await delegateSubtasksFromState();
      return;
    }

    const planStream = await engine.chat.completions.create({
      messages: [{ role: 'user', content: planPrompt }],
      max_tokens: 512,
      stream: true,
      temperature: 0.2
    });

    let planText = '';
    for await (const chunk of planStream) {
      const delta = chunk.choices?.[0]?.delta?.content || '';
      if (!delta) continue;
      planText += delta;
      sharedState.generation.partialOutput = planText;
      broadcast({
        type: 'token',
        partialOutput: planText,
        generation: { ...sharedState.generation, phase: 'plan_stream' }
      });
      await saveCheckpoint();
    }

    const parsed = parseSubtasksFromPlanText(planText);
    if (!parsed) throw new Error('Plan was not an array');

    sharedState.subtasks = parsed;
    sharedState.status = 'running';
    sharedState.generation.phase = 'delegating';
    sharedState.generation.streaming = false;
    bumpVersion();
    broadcastState();

    await delegateSubtasksFromState();
  } catch (e) {
    log(`Job could not start: ${e.message}`);
    sharedState.status = 'error';
    metricsState.failures += 1;
    noteQuality(`Task failed to start: ${e.message}`);
    finalizeMetricsAndPersist();
    broadcastState();
  }
}

function downloadCode() {
  const code =
    sharedState.generation.partialOutput ||
    P2PAgents.results.join('\n\n---\n\n') ||
    document.getElementById('output')?.textContent ||
    '';
  const blob = new Blob([code], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `southstack-p2p-${P2PAgents.roomId || 'out'}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadLatestMetrics() {
  const latest = getLatestMetrics() || metricsState;
  const blob = new Blob([JSON.stringify(latest, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `southstack-p2p-metrics-${latest.taskId || 'latest'}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function copyText(label, text) {
  if (!text) {
    setRoomStatus(`Nothing to copy for ${label}.`);
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    setRoomStatus(`${label} copied to clipboard.`);
  } catch {
    setRoomStatus(`Clipboard blocked. Manually copy ${label} from the textbox.`);
  }
}

async function copyRoomId() {
  const rid = document.getElementById('roomId');
  const roomId = rid && typeof rid.value === 'string' ? rid.value.trim() : '';
  await copyText('room code', roomId);
}

async function copyJoinLink() {
  const link = getJoinLinkValue();
  await copyText('invite link', link);
}

async function shareJoinLink() {
  const link = getJoinLinkValue();
  if (!link) {
    setRoomStatus('Create a room first to get an invite link.');
    return;
  }
  try {
    if (navigator.share) {
      await navigator.share({ title: 'SouthStack invite', text: `Join my room: ${P2PAgents.roomId}`, url: link });
      setRoomStatus('Invite link shared.');
      return;
    }
  } catch {}
  await copyText('invite link', link);
}

function applyInviteLink() {
  const input = document.getElementById('inviteLinkInput');
  const raw = input && typeof input.value === 'string' ? input.value.trim() : '';
  if (!raw) {
    setRoomStatus('Paste an invite link first (from the host).');
    return;
  }
  try {
    const parsed = new URL(raw);
    const room = parsed.searchParams.get('room') || '';
    const auth = (parsed.searchParams.get('auth') || '').trim();
    if (!room) {
      setRoomStatus('That link has no room code in it.');
      return;
    }
    if (auth) sessionAuthToken = auth;
    const rid = document.getElementById('roomId');
    if (rid) rid.value = room;
    updateJoinLinkField(room);
    if (wantsUrlAutoJoin(parsed.searchParams)) {
      setRoomStatus(`Joining room <strong>${room}</strong>…`);
      void (async () => {
        await new Promise(r => setTimeout(r, 300));
        await runInviteAutoJoinFromRoomId(room);
      })();
    } else {
      setRoomStatus(`Invite link applied. Room <strong>${room}</strong> — tap Join room when ready.`);
    }
  } catch {
    setRoomStatus('That does not look like a valid link.');
  }
}

async function copyOfferSdp() {
  const box = document.querySelector('#myOffer textarea');
  const offer = box && typeof box.value === 'string' ? box.value.trim() : '';
  await copyText('host connection text', offer);
}

async function copyJoinerAnswer() {
  const ja = document.getElementById('joinerAnswer');
  const answer = ja && typeof ja.value === 'string' ? ja.value.trim() : '';
  await copyText('guest reply', answer);
}

function stringifyStreamPart(v) {
  if (v == null || v === '') return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) {
    return v
      .map(part => {
        if (typeof part === 'string') return part;
        if (part && typeof part.text === 'string') return part.text;
        if (part && typeof part.content === 'string') return part.content;
        return '';
      })
      .join('');
  }
  if (typeof v === 'object' && typeof v.text === 'string') return v.text;
  return '';
}

function streamChunkText(chunk) {
  const c0 = chunk?.choices?.[0];
  if (!c0) return '';
  const d = c0.delta || c0.message;
  if (d) {
    const fromContent = stringifyStreamPart(d.content);
    if (fromContent) return fromContent;
    if (typeof d.text === 'string') return d.text;
  }
  if (typeof c0.text === 'string') return c0.text;
  return stringifyStreamPart(c0.content);
}

/**
 * Console / DevTools API: one-shot local WebGPU coding reply (no central API).
 * Streams token text to the console and returns the full string.
 * @param {string} userText
 * @param {{ maxTokens?: number, temperature?: number, skipInit?: boolean, onToken?: (delta: string, full: string) => void }} [opts]
 */
async function consoleCodingPrompt(userText, opts = {}) {
  const text = String(userText || '').trim();
  if (!text) {
    console.warn('[SouthStack P2P] promptCoding: empty string');
    return '';
  }
  console.info('%c[SouthStack P2P]%c prompt →', 'color:#00c7ff;font-weight:bold', 'color:inherit', text);
  if (!isProgrammingPrompt(text)) {
    console.info('%c[SouthStack P2P]%c non-coding prompt blocked', 'color:#ff9f0a;font-weight:bold', 'color:inherit');
    return NON_CODING_REPLY;
  }
  if (!opts.skipInit) await initEngine();
  if (!engine || !modelLoaded) throw new Error('AI engine is not ready yet.');
  const maxTokens = opts.maxTokens ?? 768;
  const temperature = opts.temperature ?? 0.2;
  const onToken = typeof opts.onToken === 'function' ? opts.onToken : null;
  const stream = await engine.chat.completions.create({
    messages: [
      {
        role: 'system',
        content: CODING_ASSISTANT_SYSTEM_PROMPT
      },
      {
        role: 'user',
        content: text
      }
    ],
    max_tokens: maxTokens,
    stream: true,
    temperature
  });
  let full = '';
  for await (const chunk of stream) {
    const delta = streamChunkText(chunk);
    if (!delta) continue;
    full += delta;
    console.log(delta);
    if (onToken) onToken(delta, full);
  }
  console.info('%c[SouthStack P2P]%c reply length:', 'color:#34c759;font-weight:bold', 'color:inherit', full.length);
  return full;
}

async function askCodingLLM() {
  stopSpeaking();
  if (voiceListening) stopVoiceListening(false);
  const inp = document.getElementById('askLlmInput');
  const btn = document.getElementById('askLlmBtn');
  const text = inp && typeof inp.value === 'string' ? inp.value.trim() : '';
  const clearAskInput = () => {
    if (inp && typeof inp.value === 'string') inp.value = '';
  };
  if (!text) {
    refreshAskLlmDisplay();
    console.warn('[SouthStack P2P] Ask: empty prompt');
    return;
  }

  if (channelsByPeer.size >= 1 && !P2PAgents.isLeader) {
    try {
      pendingLlmAskRequestId = `ask_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      pendingGuestPrompt = text;
      broadcast({
        type: 'llm_ask',
        prompt: text,
        requestId: pendingLlmAskRequestId,
        fromPeerId: localPeerId
      });
      clearAskInput();
      refreshAskLlmDisplay();
      log('Ask sent to coordinator — same chat updates on all devices.');
      return;
    } catch (err) {
      console.warn('[SouthStack P2P] Ask broadcast failed:', err);
      updateStatus('Failed to send Ask to coordinator. Please retry.', 'pending');
      return;
    }
  }

  try {
    clearAskInput();
    await enqueueLeaderLlm(() => runSharedLlmOnLeader(text, localPeerId));
  } finally {
    updateAskUiLocks();
  }
}

function stopAskCodingLLM() {
  stopSpeaking();
  const linked = channelsByPeer.size >= 1;
  const busy = !!sharedState.llmChat.busy;
  const guestWait = linked && !P2PAgents.isLeader && !!pendingGuestPrompt;
  if (!busy && !guestWait) {
    updateAskUiLocks();
    return;
  }

  if (linked && !P2PAgents.isLeader) {
    broadcast({
      type: 'llm_stop',
      fromPeerId: localPeerId,
      requestId: pendingLlmAskRequestId || null
    });
    pendingGuestPrompt = null;
    pendingLlmAskRequestId = null;
    log('Stop requested from coordinator.');
    refreshAskLlmDisplay();
    return;
  }

  if (typeof activeSharedAskStop === 'function') {
    activeSharedAskStop({ byPeerId: localPeerId });
    log('Stopping current Ask…');
  } else if (sharedState.llmChat.busy) {
    if (recoverSharedAskAsStopped(localPeerId)) {
      bumpVersion();
      broadcast({ type: 'llm_shared_done', llmChat: cloneLlmChat(sharedState.llmChat) });
      broadcastState();
      refreshAskLlmDisplay();
      log('Recovered Ask UI from a stuck busy state (saved stopped message).');
    }
  }
  updateAskUiLocks();
}

function testSendMessage() {
  const [peerId, dc] = Array.from(channelsByPeer.entries())[0] || [];
  if (!dc) {
    log('testSendMessage: no connected peer.');
    return;
  }
  sendOnChannel(
    dc,
    {
      type: 'transport_ping',
      fromPeerId: localPeerId,
      sentAt: Date.now(),
      probe: true
    },
    peerId
  );
  log(`testSendMessage: ping sent to ${String(peerId).slice(0, 8)}…`);
}

function testBroadcast() {
  broadcast({
    type: 'state',
    state: compactStateForWire(sharedState),
    probe: true
  });
  log(`testBroadcast: state broadcast to ${channelsByPeer.size} peer(s).`);
}

async function testTask() {
  if (!P2PAgents.isLeader) {
    log('testTask: run on coordinator/host.');
    return;
  }
  const fake = {
    id: Date.now(),
    text: '[analyzer] quick probe task: return JSON summary for this tiny task',
    assignedTo: null,
    status: 'pending'
  };
  const assignee = chooseAssigneeForSubtask();
  fake.assignedTo = assignee;
  fake.status = 'running';
  if (assignee === localPeerId) {
    await runSubtaskRemote({ taskId: sharedState.taskId || 'probe', subtaskId: fake.id, payload: fake.text });
    log('testTask: executed locally.');
    return;
  }
  const ok = await sendSubtaskWithRetry(fake, assignee);
  log(`testTask: dispatched to ${String(assignee).slice(0, 8)}… ack=${ok}`);
}

// Expose for inline HTML onclick + manual answer paste
window.P2PAgents = P2PAgents;
window.createRoom = createRoom;
window.generateNextOffer = generateNextOffer;
window.joinRoom = joinRoom;
window.assignTask = assignTask;
window.downloadCode = downloadCode;
window.downloadLatestMetrics = downloadLatestMetrics;
window.completeHandshakeAnswer = completeHandshakeAnswer;
window.getLocalPeerId = () => localPeerId;
window.copyRoomId = copyRoomId;
window.copyOfferSdp = copyOfferSdp;
window.copyJoinerAnswer = copyJoinerAnswer;
window.copyJoinLink = copyJoinLink;
window.shareJoinLink = shareJoinLink;
window.applyInviteLink = applyInviteLink;
window.toggleJoinQr = toggleJoinQr;
window.applyLanBaseToInviteLink = applyLanBaseToInviteLink;
window.easyStartSessionAndShowQr = easyStartSessionAndShowQr;
window.refreshLanHintPanel = refreshLanHintPanel;
window.consoleCodingPrompt = consoleCodingPrompt;
window.promptCoding = consoleCodingPrompt;
window.askCodingLLM = askCodingLLM;
window.stopAskCodingLLM = stopAskCodingLLM;
window.testSendMessage = testSendMessage;
window.testBroadcast = testBroadcast;
window.testTask = testTask;

function forceDisconnect() {
  stopHostHeartbeatTimer();
  stopClientHostWatchdog();
  const ids = [...channelsByPeer.keys()];
  for (const pid of ids) {
    try {
      channelsByPeer.get(pid)?.close();
    } catch {
      /* ignore */
    }
  }
  queueMicrotask(() => {
    for (const pid of [...channelsByPeer.keys()]) {
      onTransportGone(pid, 'force_disconnect');
    }
  });
  try {
    localConnection?.close();
  } catch {
    /* ignore */
  }
  localConnection = null;
  try {
    pendingLeaderConnection?.close();
  } catch {
    /* ignore */
  }
  pendingLeaderConnection = null;
  peerConnectionsByPeer.forEach(pc => {
    try {
      pc.close();
    } catch {
      /* ignore */
    }
  });
  peerConnectionsByPeer.clear();
  log('forceDisconnect: closed local P2P links.');
}

window.forceDisconnect = forceDisconnect;
window.printPeers = function printPeers() {
  const snapshot = {
    peerId: localPeerId,
    role: P2PAgents.role,
    hostId: P2PAgents.leaderId,
    connectedPeerIds: [...channelsByPeer.keys()],
    knownPeerIds: [...P2PAgents.knownPeerIds]
  };
  console.log('[printPeers]', snapshot);
  return snapshot;
};
window.printRole = function printRole() {
  const o = { peerId: localPeerId, role: P2PAgents.role, hostId: P2PAgents.leaderId };
  console.log('[printRole]', o);
  return o;
};

/** Legacy southstack / southstack-demo: console-only prompt (user message, no coding filter). */
window.ask = legacyConsoleAsk;

window.SouthStack = {
  version: 'unified-p2p',
  clearRuntimeCaches: clearSouthStackRuntimeCaches,
  checkRAM: checkRAMSouthStack,
  checkStorageQuota: checkStorageQuotaSouthStack,
  formatError: formatErrorLegacy,
  getEngine: () => engine,
  getConfig: () => ({ ...CONFIG }),
  getSystemStatus: async () => {
    const storage = await checkStorageQuotaSouthStack();
    const ramGB = await checkRAMSouthStack();
    return {
      webGPU: !!navigator.gpu,
      ramGB,
      storage,
      online: navigator.onLine,
      modelLoaded: !!modelLoaded,
      modelName: lastLoadedModelId,
      roomId: P2PAgents.roomId || null,
      isCoordinator: !!P2PAgents.isLeader,
      role: P2PAgents.role,
      hostId: P2PAgents.leaderId || null,
      peerId: localPeerId,
      linkedPeers: channelsByPeer.size
    };
  },
  reset: () => {
    window.location.reload();
  },
  /** Console: SouthStack.getVoiceSupport() — mic/TTS prerequisites. */
  getVoiceSupport: () => ({
    secureContext: typeof window !== 'undefined' ? !!window.isSecureContext : null,
    speechRecognition: !!getSpeechRecognitionCtor(),
    speechSynthesis: typeof speechSynthesis !== 'undefined',
    listening: voiceListening,
    sessionActive: voiceSessionActive,
    lastError: voiceLastError || null,
    prefs: voicePrefs()
  })
};

ensureWebGPUAdapterCompat();

async function init() {
  dbgLog('pre-fix-v2', 'N0', 'main.js:init', 'instrumented build loaded', {
    href: window.location.href
  });
  window.addEventListener('error', ev => {
    dbgLog('pre-fix-v2', 'N6', 'main.js:window:error', 'window error', {
      message: ev?.message || 'unknown',
      filename: ev?.filename || '',
      lineno: ev?.lineno || 0
    });
  });
  window.addEventListener('unhandledrejection', ev => {
    const reason = ev?.reason && ev.reason.message ? ev.reason.message : String(ev?.reason ?? '');
    dbgLog('pre-fix-v2', 'N6', 'main.js:window:unhandledrejection', 'unhandled rejection', {
      reason
    });
  });
  localWebGpuLikely = await detectLocalWebGpuLikely();
  peerWebGpuByPeer.set(localPeerId, localWebGpuLikely);
  authenticatedPeers.set(localPeerId, true);
  const params = new URLSearchParams(window.location.search);
  if ('serviceWorker' in navigator && params.get('nosw') !== '1') {
    navigator.serviceWorker
      .register('./sw.js?v=9', { updateViaCache: 'none' })
      .catch(() => {});
  } else if ('serviceWorker' in navigator && params.get('nosw') === '1') {
    navigator.serviceWorker.getRegistrations?.().then(regs => regs.forEach(r => r.unregister()));
  }
  restoreLanBaseField();
  void refreshLanHintPanel();
  const hint = document.getElementById('signalHint');
  if (hint && typeof BroadcastChannel === 'undefined') {
    hint.textContent = 'This browser cannot auto-fill the long text. Copy and paste it between devices.';
  }
  applyLeader();
  updatePeers();
  initVoiceControls();

  let doInviteAuto = false;

  // Trigger coordinator election when new peer joins
  setTimeout(() => checkCoordinatorNeeded(), 500);

  if (P2PAgents.isLeader) {
    await restoreCheckpointIfAny();
    const inviteParams = getInviteSearchParams();
    const roomFromUrl = (inviteParams.get('room') || '').trim();
    const authFromUrl = (inviteParams.get('auth') || '').trim();
    const saved = !roomFromUrl ? readSessionSnapshot() : null;
    const roomFromSaved = saved?.roomId ? String(saved.roomId).trim() : '';
    doInviteAuto = !!roomFromUrl && wantsUrlAutoJoin(inviteParams);
    if (roomFromUrl) {
      if (authFromUrl) sessionAuthToken = authFromUrl;
      const rid = document.getElementById('roomId');
      if (rid) rid.value = roomFromUrl;
      updateJoinLinkField(roomFromUrl);
      if (doInviteAuto) {
        updateStatus('Connecting to host (invite link)…', 'pending');
        setRoomStatus(`Opening invite for room <strong>${roomFromUrl}</strong>…`);
        void (async () => {
          await new Promise(r => setTimeout(r, 250));
          await runInviteAutoJoinFromRoomId(roomFromUrl);
        })();
      }
    } else if (roomFromSaved) {
      if (saved?.authToken) sessionAuthToken = String(saved.authToken);
      const rid2 = document.getElementById('roomId');
      if (rid2) rid2.value = roomFromSaved;
      P2PAgents.roomId = roomFromSaved;
      ensureSignalBus(roomFromSaved);
      updateJoinLinkField(roomFromSaved);
      setRoomStatus(
        `Recovered previous room <strong>${roomFromSaved}</strong>. Reconnecting to peers automatically…`
      );
      if (saved?.wasLeader) {
        void generateNextOffer();
      } else {
        scheduleAutoReconnect('restored session');
      }
    } else if (params.get('easy') === '1') {
      void easyStartSessionAndShowQr();
    }
  }
  log('Ready to connect devices.');
  log(`This device id: ${localPeerId}`);
  if (FAST_MODEL_ONLY) {
    log('Fast model mode is ON (?lite=1 or ?fast=1): only TinyLlama loads for quicker first-time download.');
  }
  if (OFFLINE_LAN) {
    log('Offline/LAN mode (?offline=1): no Google STUN — use same Wi‑Fi or paste SDP between machines.');
  }
  console.info(
    '%cSouthStack (unified)%c · P2P + WebGPU. Console:\n' +
      '  await ask("Hello") — legacy demo-style (user message only)\n' +
      '  await promptCoding("…") — coding assistant (system prompt + filter)\n' +
      '  SouthStack.getSystemStatus() — RAM/storage/model/P2P snapshot',
    'color:#00c7ff;font-weight:bold',
    'color:inherit'
  );
  try {
    if (doInviteAuto) {
      void (async () => {
        try {
          await initEngine();
          updateStatus('AI ready. Create or join a room.', 'connected');
        } catch {
          updateStatus('Guest OK — local model not used on this device (P2P still works).', 'connected');
        }
      })();
    } else {
      await initEngine();
      updateStatus('AI ready. Create or join a room.', 'connected');
    }
  } catch (e) {
    if (isWebGpuUnsupportedError(e)) {
      updateStatus('No WebGPU on this device. Join/create a room; Ask runs on a linked WebGPU coordinator.', 'pending');
      log('No WebGPU here: this device can still participate as a guest while another linked device runs AI.');
    } else {
      updateStatus(`Error: ${e.message}`, 'disconnected');
    }
  }
  voiceSyncBaselineFromChat();
}

window.southstackVoiceAsk = () => void startVoiceListeningForField('askLlmInput');
window.southstackVoiceTask = () => void startVoiceListeningForField('taskInput');

init();
