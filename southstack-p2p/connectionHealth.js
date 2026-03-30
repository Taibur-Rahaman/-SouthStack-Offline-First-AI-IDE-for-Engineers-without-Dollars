export const CONNECTION_HEALTH = {
  heartbeatIntervalMs: 2000,
  peerStaleMs: 6000,
  // Backward-compatible alias used by main.js runtime
  staleHeartbeatMs: 6000,
  requiredPeers: 3,
  // Backward-compatible alias used by main.js runtime
  requiredPeersIncludingSelf: 3,
  requiredOpenChannels: 2,
  stableWindowMs: 10000
};

export function createConnectionHealthState() {
  return {
    lastSeenByPeer: new Map()
  };
}

export function markPeerSeen(state, peerId, at = Date.now()) {
  if (!state || !state.lastSeenByPeer || !peerId) return;
  state.lastSeenByPeer.set(peerId, at);
}

export function removePeer(state, peerId) {
  if (!state || !state.lastSeenByPeer || !peerId) return;
  state.lastSeenByPeer.delete(peerId);
}

export function summarizeHealth(state, now = Date.now(), staleMs = CONNECTION_HEALTH.peerStaleMs) {
  const stalePeers = [];
  let healthyRemotePeers = 0;
  for (const [peerId, lastSeen] of state.lastSeenByPeer.entries()) {
    if (now - lastSeen <= staleMs) healthyRemotePeers += 1;
    else stalePeers.push(peerId);
  }
  return {
    totalKnownRemotePeers: state.lastSeenByPeer.size,
    healthyRemotePeers,
    stalePeers
  };
}

export function evaluateThreeDeviceQuorum(state, now = Date.now(), staleMs = CONNECTION_HEALTH.peerStaleMs) {
  const summary = summarizeHealth(state, now, staleMs);
  return {
    ...summary,
    ready: summary.healthyRemotePeers >= 2
  };
}

export function computeConnectionHealth({
  knownPeerCount,
  openChannelCount,
  activePeersIncludingSelf,
  requiredPeersIncludingSelf,
  stableSince,
  now = Date.now(),
  requiredPeers = CONNECTION_HEALTH.requiredPeers,
  requiredOpenChannels = CONNECTION_HEALTH.requiredOpenChannels,
  stableWindowMs = CONNECTION_HEALTH.stableWindowMs
}) {
  // Runtime path in main.js uses activePeersIncludingSelf quorum only.
  if (typeof activePeersIncludingSelf === 'number') {
    const required = requiredPeersIncludingSelf || CONNECTION_HEALTH.requiredPeersIncludingSelf;
    const stable = activePeersIncludingSelf >= required;
    return { stable, candidate: stable, isStable: stable, stableSince: stable ? stableSince || now : 0, stableMs: 0 };
  }
  const candidate = knownPeerCount >= requiredPeers && openChannelCount >= requiredOpenChannels;
  const nextStableSince = candidate ? stableSince || now : 0;
  const stableMs = nextStableSince > 0 ? Math.max(0, now - nextStableSince) : 0;
  const isStable = candidate && stableMs >= stableWindowMs;
  return {
    candidate,
    isStable,
    stableSince: nextStableSince,
    stableMs
  };
}

export function computeHeartbeatSummary(state, now = Date.now(), staleMs = CONNECTION_HEALTH.peerStaleMs) {
  // Runtime path in main.js provides an object args shape.
  if (state && !state.lastSeenByPeer && state.lastHeartbeatByPeer) {
    const cfg = state;
    const staleAfterMs = cfg.staleAfterMs || staleMs;
    const activePeerIds = [];
    const stalePeerIds = [];
    for (const peerId of cfg.connectedPeerIds || []) {
      const lastSeen = cfg.lastHeartbeatByPeer.get(peerId);
      if (typeof lastSeen === 'number' && cfg.nowMs - lastSeen <= staleAfterMs) activePeerIds.push(peerId);
      else stalePeerIds.push(peerId);
    }
    return {
      activeCount: activePeerIds.length + 1, // include self
      activePeerIds,
      stalePeerIds
    };
  }
  return summarizeHealth(state, now, staleMs);
}
