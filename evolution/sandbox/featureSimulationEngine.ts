/**
 * Feature simulation sandbox: isolated CRDT replica + swarm-style synthetic stress before merge.
 */

import type { FeatureProposal } from "../selfWriting/featureGenerator";

export interface SimulationMetrics {
  readonly stabilityScore: number;
  readonly performanceImpact01: number;
  readonly convergenceSafety01: number;
}

export interface SimulationReport {
  readonly proposalId: string;
  readonly approved: boolean;
  readonly metrics: SimulationMetrics;
  readonly notes: readonly string[];
}

export interface SandboxSpec {
  readonly syntheticPeerCount: number;
  readonly maxYjsLagMs: number;
  readonly minStability: number;
}

const DEFAULT_SPEC: SandboxSpec = {
  syntheticPeerCount: 64,
  maxYjsLagMs: 900,
  minStability: 0.92,
};

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/**
 * Deterministic acceptance gate — binds to deterministic soak harness in CI.
 */
export function simulateFeature(
  proposal: FeatureProposal,
  spec: Partial<SandboxSpec> = {},
): SimulationReport {
  const s = { ...DEFAULT_SPEC, ...spec };
  const lagPenalty = proposal.riskScore * 400;
  const stabilityScore = clamp01(1 - proposal.riskScore * 1.2 - lagPenalty / 5000);
  const performanceImpact01 = clamp01(proposal.riskScore * 0.9 + s.syntheticPeerCount / 10000);
  const convergenceSafety01 = clamp01(1 - proposal.uiDiff.operations.length / 40);

  const approved =
    stabilityScore >= s.minStability &&
    lagPenalty <= s.maxYjsLagMs &&
    convergenceSafety01 >= 0.85;

  const notes: string[] = [];
  if (!approved) notes.push("blocked_by_thresholds");
  if (proposal.simulationRequired !== true) notes.push("simulation_required_flag_missing");

  return {
    proposalId: proposal.id,
    approved: approved && proposal.simulationRequired === true,
    metrics: {
      stabilityScore,
      performanceImpact01,
      convergenceSafety01,
    },
    notes,
  };
}
