/**
 * Observability reasoning: interprets telemetry, hypothesizes root causes, suggests topology actions.
 */

import type { GlobalTelemetrySnapshot } from "../../infra/observability/globalTelemetry";
import type { TopologyMode } from "../network/adaptiveMeshRebuilder";

export type RootCauseHypothesis =
  | "turn_saturation"
  | "signaling_contention"
  | "chunk_loss_burst"
  | "yjs_sync_backlog"
  | "awareness_flood"
  | "healthy";

export interface TopologyRecommendation {
  readonly modeBias: TopologyMode;
  readonly notes: string;
}

export interface HealthInterpretation {
  readonly summary: string;
  readonly hypotheses: readonly RootCauseHypothesis[];
  readonly topology: TopologyRecommendation;
}

export function interpretTelemetry(snapshot: GlobalTelemetrySnapshot): HealthInterpretation {
  const hypotheses: RootCauseHypothesis[] = [];
  if (snapshot.turnUsageRatio > 0.85) hypotheses.push("turn_saturation");
  if (snapshot.webrtcLatency.p95 > 700) hypotheses.push("signaling_contention");
  if (snapshot.chunkReliability < 0.999) hypotheses.push("chunk_loss_burst");
  if (snapshot.yjsConvergenceP95Ms > 800) hypotheses.push("yjs_sync_backlog");
  if (snapshot.awarenessPropagationP95Ms > 700) hypotheses.push("awareness_flood");
  if (hypotheses.length === 0) hypotheses.push("healthy");

  let modeBias: TopologyMode = "partial_mesh";
  let notes = "maintain hybrid mesh";

  if (hypotheses.includes("turn_saturation")) {
    modeBias = "relay_assisted";
    notes = "prefer relay-assisted edges; widen TURN pool";
  } else if (hypotheses.includes("signaling_contention")) {
    modeBias = "partial_mesh";
    notes = "reduce mesh degree; rebalance signaling path";
  } else if (hypotheses.includes("chunk_loss_burst")) {
    modeBias = "relay_assisted";
    notes = "stabilize long-path peers before dense mesh";
  }

  const summary =
    hypotheses[0] === "healthy"
      ? "System within nominal SLO bands."
      : `Elevated signals: ${hypotheses.filter((h) => h !== "healthy").join(", ")}.`;

  return {
    summary,
    hypotheses,
    topology: { modeBias, notes },
  };
}
