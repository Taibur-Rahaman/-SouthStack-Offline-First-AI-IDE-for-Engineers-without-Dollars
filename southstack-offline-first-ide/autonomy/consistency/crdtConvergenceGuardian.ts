/**
 * CRDT convergence guardian: divergence risk scoring and checkpoint orchestration hints.
 * Does not alter Yjs wire format — surfaces authoritative snapshot requests for app coordinator.
 */

export interface PeerHealthScore {
  readonly peerId: string;
  readonly score: number;
  readonly chunkAckRate: number;
  readonly yjsLagP95Ms: number;
}

export interface DivergenceRisk {
  readonly score01: number;
  readonly reasons: readonly string[];
}

export interface GoldenPeerSelection {
  readonly peerId: string;
  readonly rationale: string;
}

export interface ConvergenceCheckpoint {
  readonly epoch: number;
  readonly goldenPeerId: string;
  readonly snapshotHint: "broadcast_authoritative" | "merge_ordered";
}

export function scoreDivergenceRisk(input: {
  readonly yjsLagP95Ms: number;
  readonly awarenessLagP95Ms: number;
  readonly chunkReliability: number;
}): DivergenceRisk {
  const reasons: string[] = [];
  let score = 0;
  if (input.yjsLagP95Ms > 1500) {
    score += 0.35;
    reasons.push("high_yjs_lag");
  }
  if (input.awarenessLagP95Ms > 1200) {
    score += 0.25;
    reasons.push("awareness_skew");
  }
  if (input.chunkReliability < 0.999) {
    score += 0.3;
    reasons.push("chunk_integrity_pressure");
  }
  return { score01: Math.min(1, score), reasons };
}

export function selectGoldenPeer(peers: readonly PeerHealthScore[]): GoldenPeerSelection | null {
  if (peers.length === 0) return null;
  const sorted = [...peers].sort((a, b) => b.score - a.score);
  const top = sorted[0];
  return {
    peerId: top.peerId,
    rationale: "max_health_score",
  };
}

export function proposeCheckpoint(
  epoch: number,
  golden: GoldenPeerSelection,
): ConvergenceCheckpoint {
  return {
    epoch,
    goldenPeerId: golden.peerId,
    snapshotHint: "broadcast_authoritative",
  };
}
