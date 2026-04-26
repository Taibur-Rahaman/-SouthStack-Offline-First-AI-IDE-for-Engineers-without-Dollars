import * as Y from 'yjs';

const STORAGE_KEY = 'ub-builder-yjs-update-v1';
const BC_NAME = 'ub-builder-p2p-stub';

function encodeUpdateB64(update: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < update.length; i++) binary += String.fromCharCode(update[i]!);
  return btoa(binary);
}

function decodeUpdateB64(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export type P2pAutosaveOptions = {
  debounceMs?: number;
  storageKey?: string;
  /** Cross-tab “peer” fan-out (stub until WebRTC mesh is wired) */
  broadcast?: boolean;
};

/**
 * Debounced persistence of full Yjs document state (localStorage + optional BroadcastChannel).
 * Replace with binary mesh + IndexedDB epoching when the real P2P stack lands.
 */
export function attachP2pAutosave(doc: Y.Doc, options: P2pAutosaveOptions = {}): () => void {
  const debounceMs = options.debounceMs ?? 450;
  const key = options.storageKey ?? STORAGE_KEY;
  const useBc = options.broadcast !== false && typeof BroadcastChannel !== 'undefined';
  const bc = useBc ? new BroadcastChannel(BC_NAME) : null;

  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    timer = null;
    try {
      const u = Y.encodeStateAsUpdate(doc);
      const payload = encodeUpdateB64(u);
      localStorage.setItem(key, payload);
      bc?.postMessage({ type: 'y-full-state', key, payload });
    } catch {
      /* quota / privacy mode */
    }
  };

  const onUpdate = (_u: Uint8Array, origin: unknown) => {
    if (origin === 'ub-remote-tab') return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, debounceMs);
  };

  doc.on('update', onUpdate);

  if (bc) {
    bc.onmessage = (ev: MessageEvent) => {
      const d = ev.data;
      if (!d || d.type !== 'y-full-state' || d.key !== key || typeof d.payload !== 'string') return;
      if (d.payload === localStorage.getItem(key)) return;
      try {
        Y.applyUpdate(doc, decodeUpdateB64(d.payload), 'ub-remote-tab');
      } catch {
        /* ignore corrupt */
      }
    };
  }

  return () => {
    doc.off('update', onUpdate);
    if (timer) clearTimeout(timer);
    bc?.close();
  };
}

export function tryHydrateDocFromStorage(doc: Y.Doc, storageKey: string = STORAGE_KEY): boolean {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return false;
    Y.applyUpdate(doc, decodeUpdateB64(raw), 'ub-remote-tab');
    return true;
  } catch {
    return false;
  }
}
