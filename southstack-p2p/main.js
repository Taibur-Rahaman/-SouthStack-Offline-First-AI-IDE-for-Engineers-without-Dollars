/**
 * SouthStack P2P — Fault-tolerant multi-agent coding
 * WebGPU LLM + WebRTC + shared state sync + checkpointing + leader election
 */

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
  dbStore: 'checkpoints'
};

function rtcIceServers() {
  return CONFIG.stun.map(u => ({ urls: u }));
}

/** @type {import('@mlc-ai/web-llm').MLCEngine} */
let engine = null;
let modelLoaded = false;
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
let localPeerId = newLocalPeerId();
let localConnection = null;
/** @type {Map<string, RTCDataChannel>} peerId -> channel (remote peers) */
const channelsByPeer = new Map();
/** @type {Map<string, RTCPeerConnection>} peerId -> peer connection */
const peerConnectionsByPeer = new Map();
/** @type {RTCPeerConnection | null} */
let pendingLeaderConnection = null;
let syncTimer = null;
let signalBus = null;
let latestOfferSdp = '';
let hostAnswerPollTimer = null;
let joinRoomInProgress = false;
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
/** @type {boolean | null} */

/** peerId → WebGPU available (from hello); coordinator prefers lowest id among true. */
const peerWebGpuByPeer = new Map();

/** Best-effort local WebGPU; set before first P2P hello. */
let localWebGpuLikely = false;

const P2PAgents = {
  roomId: null,
  isLeader: false,
  leaderId: null,
  /** @type {Set<string>} */
  knownPeerIds: new Set([localPeerId]),
  taskQueue: [],
  results: []
};

async function detectLocalWebGpuLikely() {
  try {
    if (typeof navigator === 'undefined' || !navigator.gpu) return false;
    const adapter = await navigator.gpu.requestAdapter();
    return !!adapter;
  } catch {
    return false;
  }
}

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
  const j = p.get('join');
  if (j != null && j !== '') {
    const lower = String(j).toLowerCase();
    if (lower === '0' || lower === 'false' || lower === 'no' || lower === 'off') return false;
    if (lower === '1' || lower === 'true' || lower === 'yes' || lower === 'on') return true;
    return false;
  }
  return p.get('invite') === '1' || p.get('autojoin') === '1';
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

function getFirstOpenPeerChannel() {
  for (const [peerId, dc] of channelsByPeer.entries()) {
    if (dc && dc.readyState === 'open') return { peerId, dc };
  }
  return null;
}

function runPeerHelloSmokeTest() {
  const target = getFirstOpenPeerChannel();
  if (!target) {
    log('Smoke test: no open peer channel yet. Connect another device first.');
    return;
  }
  const payload = {
    type: 'peer_smoke_test',
    fromPeerId: localPeerId,
    message: 'hello from peer',
    at: Date.now()
  };
  try {
    target.dc.send(JSON.stringify(payload));
    log(`Smoke test sent to ${target.peerId.slice(0, 8)}…: "hello from peer"`);
  } catch (e) {
    log(`Smoke test send failed: ${e?.message || e}`);
  }
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
      return `<div class="peer">Device ${short}${tag}${lead}${gpu}</div>`;
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
function computeLeader() {
  const ids = Array.from(P2PAgents.knownPeerIds);
  if (ids.length === 0) return localPeerId;
  const withGpu = ids.filter(id => peerWebGpuByPeer.get(id) === true);
  const pool = withGpu.length > 0 ? withGpu : ids;
  pool.sort();
  return pool[0];
}

function applyLeader() {
  const wasLeader = P2PAgents.isLeader;
  const was = P2PAgents.leaderId;
  P2PAgents.leaderId = computeLeader();
  P2PAgents.isLeader = P2PAgents.leaderId === localPeerId;
  if (was !== P2PAgents.leaderId) {
    log(`Host device: ${P2PAgents.leaderId.slice(0, 8)}… (${P2PAgents.isLeader ? 'this device' : 'another device'})`);
  }
  if (!wasLeader && P2PAgents.isLeader) {
    log(
      'This device is now the coordinator (WhatsApp-style: one Ask at a time; everyone sees the reply). Preloading the model if WebGPU is available…'
    );
    void initEngine().catch(() => {
      log(
        'AI could not load on this device — use a desktop Chrome with WebGPU for Ask, or reconnect a PC that was coordinator before.'
      );
    });
  }
  updatePeers();
}

// ---------- Messaging ----------
function broadcast(obj) {
  const payload = JSON.stringify(obj);
  for (const dc of channelsByPeer.values()) {
    if (dc.readyState === 'open') {
      try {
        dc.send(payload);
      } catch (e) {
        console.warn('send failed', e);
      }
    }
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

function mergeIncomingState(remote) {
  if (!remote || typeof remote.version !== 'number') return;
  if (remote.version <= sharedState.version) return;
  sharedState = {
    ...remote,
    subtasks: Array.isArray(remote.subtasks) ? remote.subtasks.map(s => ({ ...s })) : [],
    generation: remote.generation
      ? { ...remote.generation }
      : sharedState.generation,
    llmChat:
      remote.llmChat != null && typeof remote.llmChat === 'object'
        ? cloneLlmChat(remote.llmChat)
        : cloneLlmChat(sharedState.llmChat)
  };
  if (pendingGuestPrompt && (sharedState.llmChat.items || []).length > 0) {
    pendingGuestPrompt = null;
  }
  updatePeers();
  if (sharedState.generation.partialOutput) {
    setOutput(sharedState.generation.partialOutput);
  }
  refreshAskLlmDisplay();
}

/** @param {RTCDataChannel} dc */
function sendHello(dc) {
  const payload = JSON.stringify({
    type: 'hello',
    peerId: localPeerId,
    knownPeerIds: Array.from(P2PAgents.knownPeerIds),
    webgpu: localWebGpuLikely
  });
  if (dc.readyState === 'open') dc.send(payload);
}

function broadcastState() {
  bumpVersion();
  broadcast({ type: 'state', state: structuredClone(sharedState) });
  saveCheckpoint();
}

function startSyncTimer() {
  if (syncTimer) clearInterval(syncTimer);
  syncTimer = setInterval(() => {
    if (channelsByPeer.size === 0) return;
    bumpVersion();
    broadcast({ type: 'state', state: structuredClone(sharedState) });
  }, CONFIG.syncIntervalMs);
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
    }
  };
}

function postSignal(type, sdp) {
  if (!signalBus || !P2PAgents.roomId || !sdp) return;
  signalBus.postMessage({
    type,
    sdp,
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
  pc.onconnectionstatechange = () => {
    const s = pc.connectionState;
    log(`Connection: ${s}`);
    console.info('[SouthStack P2P] WebRTC connectionState:', s);
    if (s === 'failed') {
      log('WebRTC connection failed — same Wi‑Fi? Try ?offline=1 on BOTH devices, or check firewall.');
      setRoomStatus(
        '<strong>WebRTC could not connect.</strong> Use the <strong>same Wi‑Fi</strong> as the host (not mobile data). Add <code>?offline=1</code> to the URL on <strong>both</strong> host and guest. Keep <code>serve_with_signal.py</code> running; then refresh and join again.'
      );
    }
  };
  pc.oniceconnectionstatechange = () => {
    const ice = pc.iceConnectionState;
    log(`ICE: ${ice}`);
    if (ice === 'failed') {
      log('ICE failed — incomplete network path between devices.');
    }
  };
}

function onTransportGone(peerId) {
  if (!peerId || !channelsByPeer.has(peerId)) return;
  log(`A device left (${peerId.slice(0, 8)}…).`);
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
  P2PAgents.knownPeerIds.add(localPeerId);
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
    setRoomStatus(
      `<strong>Not linked to another device.</strong> If the other machine closed or slept, this tab is alone — WebRTC needs both sides online (like a live call). When it returns, use the same room code and <strong>Join room</strong> / host <strong>New guest</strong>. Chat history stays in this browser (IndexedDB) until you clear site data.`
    );
    updateStatus('No peer link — reconnect to continue together.', 'disconnected');
  }
}

async function createRoom() {
  P2PAgents.roomId = Math.random().toString(36).slice(2, 10);
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
  localConnection = pc;
  wireConnectionState(pc);

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
  if (pendingLeaderConnection === targetPc) pendingLeaderConnection = null;
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
    log('Devices are now linked.');
    updateStatus('Connected. Devices can share work.', 'connected');
    setRoomStatus(`Connected in room <strong>${P2PAgents.roomId || 'unknown'}</strong> — ${P2PAgents.knownPeerIds.size} device(s).`);
    sendHello(dc);
    startSyncTimer();
  };
  dc.onmessage = async e => {
    let msg;
    try {
      msg = JSON.parse(e.data);
    } catch {
      return;
    }
    await handleMessage(msg, dc);
  };
  dc.onclose = () => {
    dbgLog('pre-fix-v2', 'N5', 'main.js:datachannel:onclose', 'data channel closed', {
      remotePeerId: dc._remotePeerId || null,
      readyState: dc.readyState
    });
    log('Link to another device closed.');
    onTransportGone(dc._remotePeerId);
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
  switch (msg.type) {
    case 'hello': {
      clearP2PLinkWatchdog();
      const pid = msg.peerId;
      if (!pid) break;
      peerWebGpuByPeer.set(pid, msg.webgpu === true);
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
        webgpu: localWebGpuLikely
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
      (msg.knownPeerIds || []).forEach(id => P2PAgents.knownPeerIds.add(id));
      if (msg.peerId) {
        P2PAgents.knownPeerIds.add(msg.peerId);
        if (msg.webgpu === true || msg.webgpu === false) peerWebGpuByPeer.set(msg.peerId, msg.webgpu);
      }
      applyLeader();
      updatePeers();
      break;
    }
    case 'state':
      mergeIncomingState(msg.state);
      break;
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
      bumpVersion();
      await saveCheckpoint();
      break;
    }
    case 'subtask': {
      // Leader never receives their own delegated messages (only workers run incoming subtasks)
      if (P2PAgents.isLeader) break;
      await runSubtaskRemote(msg);
      break;
    }
    case 'subtask_result':
      if (P2PAgents.isLeader && msg.subtaskId != null) {
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
    case 'peer_smoke_test': {
      const from = (msg.fromPeerId || dc?._remotePeerId || 'unknown').slice(0, 8);
      const text = String(msg.message || '');
      log(`Smoke test message received from ${from}…: "${text}"`);
      try {
        if (dc && dc.readyState === 'open') {
          dc.send(
            JSON.stringify({
              type: 'peer_smoke_test_ack',
              fromPeerId: localPeerId,
              receivedMessage: text,
              at: Date.now()
            })
          );
        }
      } catch (e) {
        log(`Smoke test ACK send failed: ${e?.message || e}`);
      }
      break;
    }
    case 'peer_smoke_test_ack': {
      const from = (msg.fromPeerId || dc?._remotePeerId || 'unknown').slice(0, 8);
      const text = String(msg.receivedMessage || '');
      log(`Smoke test ACK from ${from}… (message received): "${text}"`);
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
  }
  P2PAgents.results.push(result || '');
  bumpVersion();
  broadcastState();
  appendOutput(`\n\n--- subtask ${subtaskId} ---\n\n${result || ''}`);
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
  bumpVersion();
  broadcastState();
  log('All parts of the job are finished.');
}

function reassignOrphanSubtasks() {
  for (const st of sharedState.subtasks) {
    if (st.status === 'running' && st.assignedTo && !P2PAgents.knownPeerIds.has(st.assignedTo)) {
      st.status = 'pending';
      st.assignedTo = null;
    }
  }
  if (P2PAgents.isLeader) {
    for (const st of sharedState.subtasks) {
      if (st.status === 'pending') {
        st.assignedTo = localPeerId;
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
    if (st.assignedTo !== localPeerId) continue;
    await runSubtaskRemote({ subtaskId: st.id, payload: st.text });
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

async function delegateSubtasksFromState() {
  const remoteIds = Array.from(P2PAgents.knownPeerIds).filter(id => id !== localPeerId);
  let idx = 0;
  for (const st of sharedState.subtasks) {
    const assignee = remoteIds.length > 0 ? remoteIds[idx % remoteIds.length] : localPeerId;
    st.assignedTo = assignee;
    st.status = 'running';
    idx += 1;
    const ch = channelsByPeer.get(assignee);
    if (assignee !== localPeerId && ch && ch.readyState === 'open') {
      ch.send(JSON.stringify({ type: 'subtask', subtaskId: st.id, payload: st.text }));
      await waitForSubtaskDone(st.id, 360000);
    } else {
      await runSubtaskRemote({ subtaskId: st.id, payload: st.text });
    }
  }
  log('Subtasks run one after another on the remote peer so the shared transcript stays readable.');
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
    ? `${planCtx}\n\nContinue from the last character only. Output ONLY valid JSON array text.\n\n${partial}`
    : `${base}\n\n(Continue from previous assistant output exactly where it left off.)\n\n${partial}`;

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
  const g = sharedState.generation;
  g.phase = `subtask_${subId}`;
  g.streaming = true;
  let acc = '';

  const stream = await engine.chat.completions.create({
    messages: [
      {
        role: 'user',
        content: `Complete this coding subtask. Return ONLY code.\n\n${task}`
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
  broadcast({
    type: 'subtask_result',
    subtaskId: subId,
    result: acc
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

  await initEngine();

  sharedState.taskId = `t_${Date.now()}`;
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
    if (!room) {
      setRoomStatus('That link has no room code in it.');
      return;
    }
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

// Expose for inline HTML onclick + manual answer paste
window.P2PAgents = P2PAgents;
window.createRoom = createRoom;
window.generateNextOffer = generateNextOffer;
window.joinRoom = joinRoom;
window.assignTask = assignTask;
window.downloadCode = downloadCode;
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
window.runPeerHelloSmokeTest = runPeerHelloSmokeTest;

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
  const inviteParams = getInviteSearchParams();
  const roomFromUrl = (inviteParams.get('room') || '').trim();
  const doInviteAuto = !!roomFromUrl && wantsUrlAutoJoin(inviteParams);
  if (roomFromUrl) {
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
  } else if (params.get('easy') === '1') {
    void easyStartSessionAndShowQr();
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
    '%cSouthStack P2P%c · Local WebGPU LLM. In this console run:\n  await promptCoding("Write a factorial in JavaScript")',
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
}

init();
