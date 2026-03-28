// IndexedDB-backed shared state for fault-tolerant streaming.
// Stores per-task checkpoints so a new leader can resume via prompt replay.

const DB_NAME = "southstack-ft";
const DB_VERSION = 1;
const STORE = "tasks";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "taskId" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(mode, fn) {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    const res = await fn(store);
    await new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    return res;
  } finally {
    try {
      db.close();
    } catch {}
  }
}

function clone(obj) {
  return obj ? JSON.parse(JSON.stringify(obj)) : obj;
}

export function newTaskState({ taskId, prompt, createdAt, peerId }) {
  return {
    taskId,
    prompt,
    createdAt: createdAt || Date.now(),
    updatedAt: Date.now(),
    status: "in_progress", // in_progress | done | error
    leaderId: peerId || null,
    seq: 0,
    partialOutput: "",
    lastCheckpointAt: null,
    // Optional debugging / observability:
    events: [], // small ring-buffer
  };
}

export async function loadTask(taskId) {
  return withStore("readonly", (store) => {
    return new Promise((resolve, reject) => {
      const req = store.get(taskId);
      req.onsuccess = () => resolve(req.result ? clone(req.result) : null);
      req.onerror = () => reject(req.error);
    });
  });
}

export async function saveTask(state) {
  const toSave = clone(state);
  toSave.updatedAt = Date.now();
  return withStore("readwrite", (store) => {
    return new Promise((resolve, reject) => {
      const req = store.put(toSave);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  });
}

export async function appendToken(taskId, token, { maxEvents = 50 } = {}) {
  const state = (await loadTask(taskId)) || null;
  if (!state) return null;
  state.partialOutput = (state.partialOutput || "") + (token || "");
  state.seq = (state.seq || 0) + 1;
  state.updatedAt = Date.now();
  if (state.events) {
    state.events.push({ t: Date.now(), type: "token", n: (token || "").length, seq: state.seq });
    if (state.events.length > maxEvents) state.events.splice(0, state.events.length - maxEvents);
  }
  await saveTask(state);
  return state;
}

export async function checkpoint(taskId, { leaderId, status } = {}) {
  const state = (await loadTask(taskId)) || null;
  if (!state) return null;
  if (leaderId !== undefined) state.leaderId = leaderId;
  if (status) state.status = status;
  state.lastCheckpointAt = Date.now();
  state.updatedAt = Date.now();
  if (state.events) {
    state.events.push({ t: Date.now(), type: "checkpoint", seq: state.seq, status: state.status, leaderId: state.leaderId });
    if (state.events.length > 50) state.events.splice(0, state.events.length - 50);
  }
  await saveTask(state);
  return state;
}

