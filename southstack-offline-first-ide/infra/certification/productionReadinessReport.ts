/**
 * Production certification report — aggregates infra + telemetry into a single readiness verdict.
 */

import type { GlobalTelemetrySnapshot } from "../observability/globalTelemetry";

export interface ProductionCertificationReport {
  readonly globalLatency: Record<string, number>;
  readonly TURNUsageRate: number;
  readonly peerStabilityScore: number;
  readonly yjsConvergenceScore: number;
  readonly chunkReliabilityScore: number;
  readonly failureRecoveryScore: number;
  readonly swarmScaleLimit: number;
  readonly productionReady: boolean;
}

export interface CertificationInputs {
  readonly telemetry: GlobalTelemetrySnapshot;
  /** Regional p95 RTT map (ms). */
  readonly regionalP95LatencyMs: Record<string, number>;
  /** Max peers validated in swarm/soak (reported limit). */
  readonly validatedSwarmPeers: number;
  /** 0–1 score from failure drills. */
  readonly failureDrillScore: number;
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

export function buildProductionReadinessReport(
  input: CertificationInputs,
): ProductionCertificationReport {
  const t = input.telemetry;
  const joinRate =
    t.peerJoin.attempts > 0
      ? t.peerJoin.successes / t.peerJoin.attempts
      : 1;

  const peerStabilityScore = clamp01(joinRate * (1 - t.webrtcLatency.p99 / 5000));
  const yjsConvergenceScore = clamp01(1 - t.yjsConvergenceP95Ms / 2000);
  const chunkReliabilityScore = clamp01(t.chunkReliability);
  const failureRecoveryScore = clamp01(input.failureDrillScore);

  const productionReady =
    joinRate >= 0.995 &&
    t.turnUsageRatio < 0.85 &&
    t.yjsConvergenceP95Ms < 1500 &&
    t.chunkReliability > 0.999 &&
    input.failureDrillScore > 0.9;

  return {
    globalLatency: { ...input.regionalP95LatencyMs },
    TURNUsageRate: t.turnUsageRatio,
    peerStabilityScore,
    yjsConvergenceScore,
    chunkReliabilityScore,
    failureRecoveryScore,
    swarmScaleLimit: input.validatedSwarmPeers,
    productionReady,
  };
}
