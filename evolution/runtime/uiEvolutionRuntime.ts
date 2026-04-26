/**
 * Autonomous UI evolution policy: usage-weighted layout emphasis and graceful degradation.
 */

export interface UiElementWeight {
  readonly elementKey: string;
  readonly usage01: number;
}

export interface UiEvolutionPolicy {
  readonly promotedKeys: readonly string[];
  readonly collapsedKeys: readonly string[];
  readonly fastPathKeys: readonly string[];
}

const PROMOTE_THRESHOLD = 0.65;
const COLLAPSE_THRESHOLD = 0.08;

export function evolveUiWeights(weights: readonly UiElementWeight[]): UiEvolutionPolicy {
  const promotedKeys = weights.filter((w) => w.usage01 >= PROMOTE_THRESHOLD).map((w) => w.elementKey);
  const collapsedKeys = weights.filter((w) => w.usage01 <= COLLAPSE_THRESHOLD).map((w) => w.elementKey);
  const fastPathKeys = promotedKeys.slice(0, Math.min(8, promotedKeys.length));
  return { promotedKeys, collapsedKeys, fastPathKeys };
}
