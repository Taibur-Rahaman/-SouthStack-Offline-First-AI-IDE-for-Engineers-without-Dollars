/**
 * WebRTC mesh instrumentation and per-peer full-resync flags (P2P sync debugging).
 * Log lines: [SEND] [RECV] [PARSED] [APPLY] [DROP] [FULL_SYNC_SENT] [FULL_SYNC_APPLIED]
 */

/** @type {Map<string, boolean>} */
const peerNeedsFullResync = new Map();

/** @param {string | null | undefined} peerId */
export function meshMarkPeerNeedsResync(peerId) {
  if (!peerId || peerId === 'pending-remote') return;
  peerNeedsFullResync.set(peerId, true);
}

/** @param {string | null | undefined} peerId */
export function meshTakePeerNeedsResync(peerId) {
  if (!peerId || peerId === 'pending-remote') return false;
  if (!peerNeedsFullResync.get(peerId)) return false;
  peerNeedsFullResync.delete(peerId);
  return true;
}

/** @param {string} remoteId @param {number} bytes */
export function meshLogSend(remoteId, bytes) {
  console.log('[SEND]', remoteId, bytes);
}

/** @param {string} remoteId @param {number} bytes */
export function meshLogRecv(remoteId, bytes) {
  console.log('[RECV]', remoteId, bytes);
}

/** @param {string} type */
export function meshLogParsed(type) {
  console.log('[PARSED]', type);
}

/** @param {string} remoteId @param {number} bytes */
export function meshLogApply(remoteId, bytes) {
  console.log('[APPLY]', remoteId, bytes);
}

/** @param {string} reason */
export function meshLogDrop(reason) {
  console.log('[DROP]', reason);
}

/** @param {string} remoteId */
export function meshLogFullSyncSent(remoteId) {
  console.log('[FULL_SYNC_SENT]', remoteId);
}

/** @param {string} remoteId */
export function meshLogFullSyncApplied(remoteId) {
  console.log('[FULL_SYNC_APPLIED]', remoteId);
}
