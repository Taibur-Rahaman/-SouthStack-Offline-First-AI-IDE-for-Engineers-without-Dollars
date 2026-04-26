/**
 * Global collective intelligence merge — federated usage sketches into unified model.
 */

import type { UsageSnapshot } from "../learning/usageEvolutionEngine";

export interface RegionalSketch {
  readonly region: string;
  readonly snapshot: UsageSnapshot;
  readonly sampleWeight: number;
}

export interface UnifiedEvolutionModel {
  readonly merged: UsageSnapshot;
  readonly regionsRepresented: number;
}

export function aggregateGlobalUsage(sketches: readonly RegionalSketch[]): UnifiedEvolutionModel {
  if (sketches.length === 0) {
    return {
      merged: {
        componentEdits: [],
        repeatedActions: [],
        failedInteractions: [],
        latencyHotspots: [],
      },
      regionsRepresented: 0,
    };
  }

  const weightSum = sketches.reduce((s, r) => s + r.sampleWeight, 0) || 1;

  const compMap = new Map<string, number>();
  const actMap = new Map<string, number>();
  const failMap = new Map<string, number>();
  const lat: { region: string; p95Ms: number }[] = [];

  for (const sk of sketches) {
    const w = sk.sampleWeight / weightSum;
    for (const c of sk.snapshot.componentEdits) {
      compMap.set(c.componentKey, (compMap.get(c.componentKey) ?? 0) + c.editCount * w);
    }
    for (const a of sk.snapshot.repeatedActions) {
      actMap.set(a.actionId, (actMap.get(a.actionId) ?? 0) + a.repeats * w);
    }
    for (const f of sk.snapshot.failedInteractions) {
      failMap.set(f.surfaceId, (failMap.get(f.surfaceId) ?? 0) + f.failures * w);
    }
    for (const h of sk.snapshot.latencyHotspots) {
      lat.push({ region: `${sk.region}:${h.region}`, p95Ms: h.p95Ms });
    }
  }

  const merged: UsageSnapshot = {
    componentEdits: [...compMap.entries()].map(([componentKey, editCount]) => ({
      componentKey,
      editCount: Math.round(editCount),
    })),
    repeatedActions: [...actMap.entries()].map(([actionId, repeats]) => ({
      actionId,
      repeats: Math.round(repeats),
    })),
    failedInteractions: [...failMap.entries()].map(([surfaceId, failures]) => ({
      surfaceId,
      failures: Math.round(failures),
    })),
    latencyHotspots: lat.map((l) => ({ region: l.region, p95Ms: l.p95Ms })),
  };

  return { merged, regionsRepresented: sketches.length };
}
