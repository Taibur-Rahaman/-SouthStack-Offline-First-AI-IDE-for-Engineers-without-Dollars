import { describe, it, expect } from 'vitest';
import {
  createConnectionHealthState,
  markPeerSeen,
  removePeer,
  evaluateThreeDeviceQuorum,
  summarizeHealth,
  computeHeartbeatSummary
} from './connectionHealth.js';

describe('connection health quorum', () => {
  it('requires two healthy remote peers (legacy shape)', () => {
    const st = createConnectionHealthState();
    const now = 10000;
    markPeerSeen(st, 'peer-a', now - 1000);
    markPeerSeen(st, 'peer-b', now - 2000);
    const q = evaluateThreeDeviceQuorum(st, now, 6000);
    expect(q.ready).toBe(true);
    expect(q.healthyRemotePeers).toBe(2);
  });

  it('fails quorum when one peer heartbeat is stale (legacy shape)', () => {
    const st = createConnectionHealthState();
    const now = 10000;
    markPeerSeen(st, 'peer-a', now - 1000);
    markPeerSeen(st, 'peer-b', now - 8000);
    const q = evaluateThreeDeviceQuorum(st, now, 6000);
    expect(q.ready).toBe(false);
    expect(q.healthyRemotePeers).toBe(1);
  });

  it('removes peer and updates summary (legacy shape)', () => {
    const st = createConnectionHealthState();
    const now = 10000;
    markPeerSeen(st, 'peer-a', now - 300);
    markPeerSeen(st, 'peer-b', now - 400);
    removePeer(st, 'peer-b');
    const summary = summarizeHealth(st, now, 6000);
    expect(summary.totalKnownRemotePeers).toBe(1);
    expect(summary.healthyRemotePeers).toBe(1);
    expect(summary.stalePeers).toEqual([]);
  });

  it('computes active/stale peers for runtime shape', () => {
    const now = 10000;
    const lastHeartbeatByPeer = new Map([
      ['peer-a', now - 2000],
      ['peer-b', now - 9000]
    ]);
    const summary = computeHeartbeatSummary({
      nowMs: now,
      localPeerId: 'self',
      connectedPeerIds: ['peer-a', 'peer-b'],
      lastHeartbeatByPeer,
      staleAfterMs: 6000
    });
    expect(summary.activeCount).toBe(2);
    expect(summary.stalePeerIds).toEqual(['peer-b']);
  });
});
