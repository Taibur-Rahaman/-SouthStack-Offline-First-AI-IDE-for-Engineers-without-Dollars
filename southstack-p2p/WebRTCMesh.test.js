import { describe, it, expect, vi } from 'vitest';
import {
  meshMarkPeerNeedsResync,
  meshTakePeerNeedsResync,
  meshLogFullSyncSent
} from './WebRTCMesh.js';

describe('WebRTCMesh resync flags', () => {
  it('marks and consumes per-peer resync', () => {
    expect(meshTakePeerNeedsResync('p1')).toBe(false);
    meshMarkPeerNeedsResync('p1');
    expect(meshTakePeerNeedsResync('p1')).toBe(true);
    expect(meshTakePeerNeedsResync('p1')).toBe(false);
  });
});

describe('WebRTCMesh logs', () => {
  it('emits [FULL_SYNC_SENT] with peer id', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    meshLogFullSyncSent('peer-abc');
    expect(spy.mock.calls.some(c => c[0] === '[FULL_SYNC_SENT]' && c[1] === 'peer-abc')).toBe(true);
    spy.mockRestore();
  });
});
