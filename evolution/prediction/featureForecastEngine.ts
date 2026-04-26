/**
 * Predictive feature intents from usage trends — outputs seeds for featureGenerator.
 */

import type { EvolutionSuggestion } from "../learning/usageEvolutionEngine";

export interface ForecastedNeed {
  readonly summary: string;
  readonly confidence01: number;
  readonly generatorSeed: number;
}

export function forecastFeatures(suggestions: readonly EvolutionSuggestion[]): ForecastedNeed[] {
  return suggestions.map((s, i) => ({
    summary: `Predicted capability: ${s.summary}`,
    confidence01: Math.min(1, s.priority * (0.85 + i * 0.01)),
    generatorSeed: 1000 + i * 17,
  }));
}
