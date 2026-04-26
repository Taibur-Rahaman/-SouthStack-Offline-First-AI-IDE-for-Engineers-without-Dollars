/**
 * Usage-driven evolution: aggregates interaction telemetry into ranked suggestions (no raw PII).
 */

export interface ComponentEditStat {
  readonly componentKey: string;
  readonly editCount: number;
}

export interface ActionStat {
  readonly actionId: string;
  readonly repeats: number;
}

export interface FailedInteractionStat {
  readonly surfaceId: string;
  readonly failures: number;
}

export interface LatencyHotspot {
  readonly region: string;
  readonly p95Ms: number;
}

export interface UsageSnapshot {
  readonly componentEdits: readonly ComponentEditStat[];
  readonly repeatedActions: readonly ActionStat[];
  readonly failedInteractions: readonly FailedInteractionStat[];
  readonly latencyHotspots: readonly LatencyHotspot[];
}

export interface EvolutionSuggestion {
  readonly kind: "feature" | "optimization" | "layout";
  readonly summary: string;
  readonly priority: number;
}

export function deriveEvolutionSuggestions(snapshot: UsageSnapshot): EvolutionSuggestion[] {
  const out: EvolutionSuggestion[] = [];

  const topEdited = [...snapshot.componentEdits].sort((a, b) => b.editCount - a.editCount)[0];
  if (topEdited && topEdited.editCount > 10) {
    out.push({
      kind: "feature",
      summary: `Deepen tooling around ${topEdited.componentKey}`,
      priority: 0.9,
    });
  }

  const noisy = snapshot.failedInteractions.find((f) => f.failures > 5);
  if (noisy) {
    out.push({
      kind: "optimization",
      summary: `Harden UX for surface ${noisy.surfaceId}`,
      priority: 0.85,
    });
  }

  const hot = snapshot.latencyHotspots.find((h) => h.p95Ms > 600);
  if (hot) {
    out.push({
      kind: "layout",
      summary: `Simplify layout path for region ${hot.region}`,
      priority: 0.7,
    });
  }

  const ritual = [...snapshot.repeatedActions].sort((a, b) => b.repeats - a.repeats)[0];
  if (ritual && ritual.repeats > 20) {
    out.push({
      kind: "feature",
      summary: `Promote shortcut for action ${ritual.actionId}`,
      priority: 0.8,
    });
  }

  return out.sort((a, b) => b.priority - a.priority);
}
