import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { URL } from 'node:url';

const port = Number(process.env.SIGNAL_PORT ?? 8787);
const DEFAULT_HOST_TTL_MS = 12000;
/** @type {Map<string, {offer: string | null, answer: string | null, candidates: Array<{fromPeerId: string, toPeerId: string, candidate: RTCIceCandidateInit, at: number}>, hostLease: {peerId: string, expiresAt: number} | null}>} */
const rooms = new Map();

function json(res, code, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', String(body.length));
  res.end(body);
}

function empty(res, code = 204) {
  res.statusCode = code;
  res.end();
}

function roomState(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, { offer: null, answer: null, candidates: [], hostLease: null });
  }
  const state = rooms.get(roomId);
  if (state.hostLease && state.hostLease.expiresAt <= Date.now()) {
    state.hostLease = null;
    state.offer = null;
    state.answer = null;
    state.candidates = [];
  }
  return state;
}

function lanIpv4s() {
  const nets = networkInterfaces();
  const out = [];
  const virtualNameRx = /(vEthernet|Hyper-V|Virtual|VMware|WSL|Loopback|Docker|Tailscale|ZeroTier|Bluetooth|Npcap)/i;
  const scoreIp = (ip) => {
    if (/^192\.168\./.test(ip)) return 0;
    if (/^10\./.test(ip)) return 1;
    if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) return 2;
    return 9;
  };
  for (const key of Object.keys(nets)) {
    if (virtualNameRx.test(key)) continue;
    for (const item of nets[key] ?? []) {
      if (item.family !== 'IPv4' || item.internal) continue;
      const ip = item.address;
      if (!ip || ip.startsWith('169.254.')) continue;
      out.push(ip);
    }
  }
  return [...new Set(out)].sort((a, b) => scoreIp(a) - scoreIp(b));
}

const server = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }
  if (req.url === '/health') {
    return json(res, 200, { ok: true, service: 'southstack-signaling' });
  }
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);

  if (req.method === 'GET' && url.pathname === '/api/southstack/ping') {
    return empty(res, 204);
  }
  if (req.method === 'GET' && url.pathname === '/api/southstack/lan-hint') {
    const ips = lanIpv4s();
    return json(res, 200, { port, ips, urls: ips.map((ip) => `http://${ip}:${port}`) });
  }
  if (req.method === 'GET' && url.pathname === '/api/southstack/host') {
    const room = url.searchParams.get('room');
    if (!room) return json(res, 400, { error: 'missing room' });
    const state = roomState(room);
    return json(res, 200, { hostPeerId: state.hostLease?.peerId ?? null, expiresAt: state.hostLease?.expiresAt ?? null });
  }
  if (req.method === 'GET' && url.pathname === '/api/southstack/offer') {
    const room = url.searchParams.get('room');
    if (!room) return json(res, 400, { error: 'missing room' });
    const state = roomState(room);
    if (!state.offer) return empty(res, 204);
    return json(res, 200, { sdp: state.offer });
  }
  if (req.method === 'GET' && url.pathname === '/api/southstack/answer') {
    const room = url.searchParams.get('room');
    if (!room) return json(res, 400, { error: 'missing room' });
    const state = roomState(room);
    if (!state.answer) return empty(res, 204);
    const sdp = state.answer;
    state.answer = null;
    return json(res, 200, { sdp });
  }
  if (req.method === 'GET' && url.pathname === '/api/southstack/candidate') {
    const room = url.searchParams.get('room');
    const peer = url.searchParams.get('peer');
    if (!room || !peer) return json(res, 400, { error: 'missing room or peer' });
    const state = roomState(room);
    const mine = [];
    const keep = [];
    for (const item of state.candidates) {
      if (item.fromPeerId === peer) {
        keep.push(item);
        continue;
      }
      if (item.toPeerId && item.toPeerId !== peer) {
        keep.push(item);
        continue;
      }
      mine.push(item);
    }
    state.candidates = keep;
    if (!mine.length) return empty(res, 204);
    return json(res, 200, { candidates: mine });
  }

  if (
    req.method === 'POST' &&
    ['/api/southstack/offer', '/api/southstack/answer', '/api/southstack/candidate', '/api/southstack/host/claim', '/api/southstack/host/heartbeat', '/api/southstack/host/release'].includes(url.pathname)
  ) {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      let body = {};
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      } catch {
        json(res, 400, { error: 'invalid json' });
        return;
      }
      if (url.pathname === '/api/southstack/host/claim') {
        const room = String(body.room || '');
        const peerId = String(body.peerId || '');
        const ttlMs = Math.max(2000, Number(body.ttlMs || DEFAULT_HOST_TTL_MS));
        if (!room || !peerId) return json(res, 400, { error: 'room and peerId required' });
        const state = roomState(room);
        if (state.hostLease && state.hostLease.peerId !== peerId && state.hostLease.expiresAt > Date.now()) {
          return json(res, 200, { ok: true, role: 'guest', hostPeerId: state.hostLease.peerId, expiresAt: state.hostLease.expiresAt });
        }
        const expiresAt = Date.now() + ttlMs;
        state.hostLease = { peerId, expiresAt };
        return json(res, 200, { ok: true, role: 'host', hostPeerId: peerId, expiresAt });
      }
      if (url.pathname === '/api/southstack/host/heartbeat') {
        const room = String(body.room || '');
        const peerId = String(body.peerId || '');
        const ttlMs = Math.max(2000, Number(body.ttlMs || DEFAULT_HOST_TTL_MS));
        if (!room || !peerId) return json(res, 400, { error: 'room and peerId required' });
        const state = roomState(room);
        if (!state.hostLease || state.hostLease.peerId !== peerId) return json(res, 409, { error: 'not host' });
        state.hostLease.expiresAt = Date.now() + ttlMs;
        return json(res, 200, { ok: true, hostPeerId: peerId, expiresAt: state.hostLease.expiresAt });
      }
      if (url.pathname === '/api/southstack/host/release') {
        const room = String(body.room || '');
        const peerId = String(body.peerId || '');
        if (!room || !peerId) return json(res, 400, { error: 'room and peerId required' });
        const state = roomState(room);
        if (state.hostLease?.peerId === peerId) {
          state.hostLease = null;
          state.offer = null;
          state.answer = null;
          state.candidates = [];
        }
        return json(res, 200, { ok: true });
      }
      if (url.pathname === '/api/southstack/offer') {
        const room = String(body.room || '');
        const sdp = String(body.sdp || '');
        if (!room || !sdp) return json(res, 400, { error: 'room and sdp required' });
        const state = roomState(room);
        state.offer = sdp;
        state.answer = null;
        state.candidates = [];
        return json(res, 200, { ok: true });
      }
      if (url.pathname === '/api/southstack/answer') {
        const room = String(body.room || '');
        const sdp = String(body.sdp || '');
        if (!room || !sdp) return json(res, 400, { error: 'room and sdp required' });
        const state = roomState(room);
        state.answer = sdp;
        return json(res, 200, { ok: true });
      }
      const room = String(body.room || '');
      const fromPeerId = String(body.fromPeerId || '');
      const toPeerId = String(body.toPeerId || '');
      const candidate = body.candidate;
      if (!room || !fromPeerId || !candidate) return json(res, 400, { error: 'room, fromPeerId and candidate required' });
      const state = roomState(room);
      state.candidates.push({ fromPeerId, toPeerId, candidate, at: Date.now() });
      if (state.candidates.length > 300) {
        state.candidates = state.candidates.slice(-300);
      }
      return json(res, 200, { ok: true });
    });
    return;
  }
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.statusCode = 404;
  res.end('Not found\n');
});

server.listen(port, () => {
  const ips = lanIpv4s();
  console.log(`[signaling stub] http://127.0.0.1:${port}`);
  if (ips.length) console.log(`[signaling lan] ${ips.map((ip) => `http://${ip}:${port}`).join(', ')}`);
});
