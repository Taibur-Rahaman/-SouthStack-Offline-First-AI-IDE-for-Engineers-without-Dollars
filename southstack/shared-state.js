/**
 * Replicated state log + periodic snapshots.
 * - Each peer persists snapshots in IndexedDB (small; not model weights).
 * - Replication is "best effort" via broadcast; conflicts resolved with LWW by (clock, peerId).
 *
 * This is intentionally simple (demo-grade) and is designed to support:
 * - streaming token checkpoints
 * - leader election metadata
 * - task reassignment metadata
 */
 
const DB_NAME = "southstack-ft";
const DB_VERSION = 1;
const STORE = "snapshots";
 
function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
 
async function idbGet(key) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const st = tx.objectStore(STORE);
      const req = st.get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}
 
async function idbPut(obj) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.objectStore(STORE).put(obj);
    });
  } finally {
    db.close();
  }
}
 
function stableCompare(a, b) {
  if (a.clock !== b.clock) return a.clock - b.clock;
  if (a.peerId === b.peerId) return 0;
  return a.peerId < b.peerId ? -1 : 1;
}
 
export class SharedState {
  constructor({ sessionId, peerId } = {}) {
    this.sessionId = sessionId || "default";
    this.peerId = peerId || "unknown";
    this.clock = 0;
 
    this.state = {
      sessionId: this.sessionId,
      prompt: "",
      partialOutput: "",
      status: "idle", // idle | running | done | error
      leaderId: null,
      term: 0,
      lastUpdate: { clock: 0, peerId: "" },
      tasks: {}, // taskId -> {assignedTo,status}
      peers: {}, // peerId -> {lastSeenMs}
    };
 
    /** @type {(state: any) => void} */
    this.onState = null;
  }
 
  _bumpClock() {
    this.clock += 1;
    return this.clock;
  }
 
  _apply(update, meta) {
    // LWW: apply only if meta is newer
    if (stableCompare(meta, this.state.lastUpdate) <= 0) return false;
    update(this.state);
    this.state.lastUpdate = { ...meta };
    this.onState?.(this.get());
    return true;
  }
 
  get() {
    return JSON.parse(JSON.stringify(this.state));
  }
 
  localUpdate(mutator) {
    const meta = { clock: this._bumpClock(), peerId: this.peerId };
    const applied = this._apply(mutator, meta);
    return { applied, meta, state: this.get() };
  }
 
  mergeRemote(remoteState) {
    if (!remoteState || remoteState.sessionId !== this.sessionId) return false;
    const meta = remoteState.lastUpdate || { clock: 0, peerId: "" };
    return this._apply((s) => Object.assign(s, remoteState), meta);
  }
 
  async loadSnapshot() {
    const key = `session:${this.sessionId}`;
    const rec = await idbGet(key);
    if (!rec || !rec.value) return false;
    const snap = rec.value;
    if (snap.sessionId !== this.sessionId) return false;
    this.state = snap;
    this.clock = Math.max(this.clock, (snap.lastUpdate?.clock || 0));
    this.onState?.(this.get());
    return true;
  }
 
  async saveSnapshot() {
    const key = `session:${this.sessionId}`;
    await idbPut({ key, value: this.get(), savedAt: Date.now() });
  }
}
 
