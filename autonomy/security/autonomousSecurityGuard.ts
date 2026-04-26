/**
 * Autonomous security posture: trust scoring, quarantine hints for chunks and CRDT streams.
 * Validation hooks only — gateway enforcement stays at infra/security peerSecurityModel.
 */

import type { RoomCredential } from "../../infra/security/peerSecurityModel";
import {
  enforceChunkSize,
  DEFAULT_CHUNK_POLICY,
} from "../../infra/security/peerSecurityModel";

/** Hint-only tagging aligned with gateway policy; wire validation remains in app validators. */
function inferMessageFamily(
  raw: Uint8Array,
): "yjs-update" | "chunk" | "blob" | "presence" | "unknown" {
  if (raw.length === 0) return "unknown";
  const tag = String.fromCharCode(raw[0]);
  if (tag === "Y") return "yjs-update";
  if (tag === "C") return "chunk";
  if (tag === "B") return "blob";
  if (tag === "P") return "presence";
  return "unknown";
}

export interface PeerTrustState {
  readonly peerId: string;
  readonly score01: number;
  readonly strikes: number;
}

export interface SecurityDecision {
  readonly quarantinePeer: boolean;
  readonly dropChunkStream: boolean;
  readonly isolateCrdtUpdates: boolean;
}

const QUARANTINE_THRESHOLD = 0.35;
const STRIKE_QUARANTINE = 4;

export function updateTrustScore(
  state: PeerTrustState,
  badEvent: boolean,
): PeerTrustState {
  const delta = badEvent ? -0.12 : 0.02;
  const score01 = Math.max(0, Math.min(1, state.score01 + delta));
  const strikes = badEvent ? state.strikes + 1 : Math.max(0, state.strikes - 1);
  return { ...state, score01, strikes };
}

export function evaluatePeerSecurity(input: {
  readonly trust: PeerTrustState;
  readonly token: RoomCredential;
  readonly nowSec: number;
  readonly rawMessage: Uint8Array;
}): SecurityDecision {
  const expired = input.token.exp <= input.nowSec;
  const family = inferMessageFamily(input.rawMessage);
  const chunkOk =
    family === "chunk" || family === "blob"
      ? enforceChunkSize(input.rawMessage, DEFAULT_CHUNK_POLICY) === "ok"
      : true;

  const bad =
    expired ||
    !chunkOk ||
    (family === "unknown" && input.rawMessage.length > 512 * 1024);

  const trust = bad ? updateTrustScore(input.trust, true) : input.trust;

  const quarantinePeer =
    trust.score01 < QUARANTINE_THRESHOLD || trust.strikes >= STRIKE_QUARANTINE;

  return {
    quarantinePeer,
    dropChunkStream: quarantinePeer && (family === "chunk" || family === "blob"),
    isolateCrdtUpdates: quarantinePeer && family === "yjs-update",
  };
}
