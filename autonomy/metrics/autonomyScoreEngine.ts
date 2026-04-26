/**
 * Autonomy scorecard: aggregates healing cadence, convergence, topology efficiency, prediction quality.
 */

export type SystemAutonomyLevel = "low" | "medium" | "high" | "full";

export interface AutonomyScore {
  readonly selfHealingRate: number;
  readonly recoveryTime: number;
  readonly convergenceStability: number;
  readonly topologyEfficiency: number;
  readonly failurePredictionAccuracy: number;
  readonly systemAutonomyLevel: SystemAutonomyLevel;
}

export interface AutonomyScoreInputs {
  readonly repairsSucceeded: number;
  readonly repairsAttempted: number;
  readonly meanRecoveryMs: number;
  readonly yjsP95Ms: number;
  readonly meshEdgeRatio: number;
  readonly predictionHits: number;
  readonly predictionTotal: number;
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function levelFrom(
  healing: number,
  convergence: number,
  topology: number,
  prediction: number,
): SystemAutonomyLevel {
  const composite = (healing + convergence + topology + prediction) / 4;
  if (composite >= 0.9) return "full";
  if (composite >= 0.75) return "high";
  if (composite >= 0.55) return "medium";
  return "low";
}

export function computeAutonomyScore(input: AutonomyScoreInputs): AutonomyScore {
  const selfHealingRate =
    input.repairsAttempted > 0
      ? clamp01(input.repairsSucceeded / input.repairsAttempted)
      : 1;

  const recoveryTime = Math.max(0, input.meanRecoveryMs);

  const convergenceStability = clamp01(1 - input.yjsP95Ms / 2500);

  const topologyEfficiency = clamp01(1 - Math.abs(input.meshEdgeRatio - 0.35));

  const failurePredictionAccuracy =
    input.predictionTotal > 0
      ? clamp01(input.predictionHits / input.predictionTotal)
      : 0.75;

  const systemAutonomyLevel = levelFrom(
    selfHealingRate,
    convergenceStability,
    topologyEfficiency,
    failurePredictionAccuracy,
  );

  return {
    selfHealingRate,
    recoveryTime,
    convergenceStability,
    topologyEfficiency,
    failurePredictionAccuracy,
    systemAutonomyLevel,
  };
}
