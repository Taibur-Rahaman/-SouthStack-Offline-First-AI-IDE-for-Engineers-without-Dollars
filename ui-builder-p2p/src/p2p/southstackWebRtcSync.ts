import * as Y from 'yjs';

export type P2pRole = 'host' | 'guest' | 'auto';
export type P2pState = 'idle' | 'connecting' | 'connected' | 'error' | 'closed';

export type SouthstackSyncOptions = {
  role: P2pRole;
  roomId: string;
  signalBaseUrl?: string;
  pollMs?: number;
  onState?: (state: P2pState, detail?: string) => void;
};

function emit(options: SouthstackSyncOptions, state: P2pState, detail?: string) {
  options.onState?.(state, detail);
}

function toCrLf(sdp: string): string {
  const normalized = (sdp || '').replace(/\r?\n/g, '\r\n').trim();
  return `${normalized}\r\n`;
}

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

function randomPeerId(): string {
  return `ub_${Math.random().toString(36).slice(2, 10)}`;
}

async function waitIce(pc: RTCPeerConnection, timeoutMs = 12000): Promise<void> {
  if (pc.iceGatheringState === 'complete') return;
  await new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      pc.removeEventListener('icegatheringstatechange', onChange);
      resolve();
    };
    const onChange = () => {
      if (pc.iceGatheringState === 'complete') finish();
    };
    pc.addEventListener('icegatheringstatechange', onChange);
    setTimeout(finish, timeoutMs);
  });
}

export function attachSouthstackWebRtcSync(doc: Y.Doc, options: SouthstackSyncOptions): () => void {
  const base = (options.signalBaseUrl ?? 'http://127.0.0.1:8787').replace(/\/+$/, '');
  const roomId = options.roomId.trim();
  const pollMs = options.pollMs ?? 1300;
  const hostTtlMs = Math.max(3000, pollMs * 6);
  const localPeerId = randomPeerId();
  const remoteOrigin = 'ub-remote-peer';
  let closed = false;
  let restartTimer: ReturnType<typeof setTimeout> | null = null;
  let activeDetach: null | (() => void) = null;
  let currentRole: Exclude<P2pRole, 'auto'> | null = null;

  const post = async (path: string, payload: unknown) =>
    fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

  const scheduleRestart = (detail: string) => {
    if (closed || restartTimer) return;
    emit(options, 'connecting', detail);
    restartTimer = setTimeout(() => {
      restartTimer = null;
      if (closed) return;
      activeDetach?.();
      activeDetach = null;
      void run();
    }, pollMs);
  };

  const resolveAutoRole = async (): Promise<Exclude<P2pRole, 'auto'>> => {
    const claimed = await post('/api/southstack/host/claim', { room: roomId, peerId: localPeerId, ttlMs: hostTtlMs });
    if (!claimed.ok) return 'guest';
    const data = await claimed.json();
    return data?.role === 'host' ? 'host' : 'guest';
  };

  const runSession = async (role: Exclude<P2pRole, 'auto'>): Promise<() => void> => {
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let answerPoll: ReturnType<typeof setInterval> | null = null;
    let hostHeartbeat: ReturnType<typeof setInterval> | null = null;
    let dc: RTCDataChannel | null = null;
    let detached = false;
    const pc = new RTCPeerConnection({ iceServers: [] });

    const wireChannel = (channel: RTCDataChannel) => {
      dc = channel;
      channel.binaryType = 'arraybuffer';
      channel.onopen = () => {
        emit(options, 'connected', `Connected as ${role} in room ${roomId}`);
        const full = Y.encodeStateAsUpdate(doc);
        channel.send(JSON.stringify({ type: 'y-update', payload: encodeUpdateB64(full) }));
      };
      channel.onclose = () => scheduleRestart('Peer disconnected. Electing next host...');
      channel.onerror = () => scheduleRestart('Data channel error. Reconnecting...');
      channel.onmessage = (ev) => {
        try {
          const msg = JSON.parse(String(ev.data || '{}'));
          if (msg.type !== 'y-update' || typeof msg.payload !== 'string') return;
          Y.applyUpdate(doc, decodeUpdateB64(msg.payload), remoteOrigin);
        } catch {
          /* ignore malformed frames */
        }
      };
    };

    const onDocUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin === remoteOrigin || !dc || dc.readyState !== 'open') return;
      dc.send(JSON.stringify({ type: 'y-update', payload: encodeUpdateB64(update) }));
    };
    doc.on('update', onDocUpdate);

    pc.onicecandidate = (e) => {
      if (!e.candidate || closed || detached) return;
      void post('/api/southstack/candidate', {
        room: roomId,
        fromPeerId: localPeerId,
        candidate: e.candidate.toJSON(),
      });
    };
    pc.onconnectionstatechange = () => {
      if (detached || closed) return;
      if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) {
        scheduleRestart('Connection lost. Rejoining room...');
      }
    };

    const pollCandidates = async () => {
      try {
        const r = await fetch(
          `${base}/api/southstack/candidate?room=${encodeURIComponent(roomId)}&peer=${encodeURIComponent(localPeerId)}`,
          { cache: 'no-store' },
        );
        if (r.status !== 200) return;
        const body = await r.json();
        const list = Array.isArray(body?.candidates) ? body.candidates : [];
        for (const item of list) {
          if (!item?.candidate) continue;
          await pc.addIceCandidate(item.candidate);
        }
      } catch {
        /* transient network issue */
      }
    };
    const startPolling = () => {
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = setInterval(() => {
        if (closed || detached) return;
        void pollCandidates();
      }, pollMs);
    };

    emit(options, 'connecting', `Connecting as ${role}...`);
    if (role === 'host') {
      await post('/api/southstack/host/claim', { room: roomId, peerId: localPeerId, ttlMs: hostTtlMs });
      hostHeartbeat = setInterval(() => {
        if (closed || detached) return;
        void post('/api/southstack/host/heartbeat', { room: roomId, peerId: localPeerId, ttlMs: hostTtlMs });
      }, Math.max(1500, Math.floor(hostTtlMs / 3)));

      const channel = pc.createDataChannel('ub-yjs', { ordered: true });
      wireChannel(channel);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitIce(pc);
      await post('/api/southstack/offer', {
        room: roomId,
        sdp: toCrLf(pc.localDescription?.sdp ?? ''),
      });
      startPolling();
      answerPoll = setInterval(async () => {
        if (closed || detached || pc.remoteDescription) {
          if (answerPoll) clearInterval(answerPoll);
          return;
        }
        try {
          const r = await fetch(`${base}/api/southstack/answer?room=${encodeURIComponent(roomId)}`, { cache: 'no-store' });
          if (r.status !== 200) return;
          const data = await r.json();
          if (!data?.sdp) return;
          await pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: toCrLf(String(data.sdp)) }));
          if (answerPoll) clearInterval(answerPoll);
        } catch {
          /* keep polling */
        }
      }, pollMs);
    } else {
      pc.ondatachannel = (e) => wireChannel(e.channel);
      let offerSdp = '';
      while (!closed && !detached && !offerSdp) {
        const r = await fetch(`${base}/api/southstack/offer?room=${encodeURIComponent(roomId)}`, { cache: 'no-store' });
        if (r.status === 200) {
          const data = await r.json();
          offerSdp = String(data?.sdp || '');
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, pollMs));
      }
      if (!closed && !detached && offerSdp) {
        await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: toCrLf(offerSdp) }));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await waitIce(pc);
        await post('/api/southstack/answer', {
          room: roomId,
          sdp: toCrLf(pc.localDescription?.sdp ?? ''),
        });
      }
      startPolling();
    }

    return () => {
      detached = true;
      if (pollTimer) clearInterval(pollTimer);
      if (answerPoll) clearInterval(answerPoll);
      if (hostHeartbeat) clearInterval(hostHeartbeat);
      doc.off('update', onDocUpdate);
      if (role === 'host') {
        void post('/api/southstack/host/release', { room: roomId, peerId: localPeerId });
      }
      try {
        dc?.close();
      } catch {
        /* ignore */
      }
      pc.close();
    };
  };

  const run = async () => {
    try {
      currentRole = options.role === 'auto' ? await resolveAutoRole() : options.role;
      activeDetach = await runSession(currentRole);
    } catch (err) {
      emit(options, 'error', err instanceof Error ? err.message : 'P2P sync failed');
      scheduleRestart('Retrying P2P...');
    }
  };

  void run();

  return () => {
    closed = true;
    emit(options, 'closed', 'Disconnected');
    if (restartTimer) clearTimeout(restartTimer);
    activeDetach?.();
    activeDetach = null;
  };
}
