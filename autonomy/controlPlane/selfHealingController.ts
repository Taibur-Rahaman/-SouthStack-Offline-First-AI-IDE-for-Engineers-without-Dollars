/**
 * Global self-healing control plane: observes health signals and selects recovery strategies.
 * Policy-only layer — execution binds to deployment hooks; does not alter Yjs/WebRTC protocols.
 */

import type { GlobalTelemetrySnapshot } from "../../infra/observability/globalTelemetry";
import {
  recoveryPlanForFailure,
  type FailureKind,
} from "../../infra/resilience/globalFailureEngine";
import type { TurnEndpoint } from "../../infra/turn/turnLoadBalancer";
import type { PeerRoutingDecision } from "../../infra/signaling/globalSignalingMesh";

export type AnomalyKind =
  | "yjs_lag_spike"
  | "chunk_failure_spike"
  | "peer_disconnect_surge"
  | "turn_degradation"
  | "signaling_latency_spike";

export interface HealthObservation {
  readonly telemetry: GlobalTelemetrySnapshot;
  readonly recentDisconnectRate: number;
  readonly turnProbeFailureRate: number;
}

export interface SelfHealingDecision {
  readonly anomalies: readonly AnomalyKind[];
  readonly mappedFailure: FailureKind;
  readonly rerouteTurnRegions: readonly string[];
  readonly forceYjsResyncFromPeerId: string | null;
  readonly rebuildMesh: boolean;
  readonly restartSignaling: boolean;
}

const DEFAULT_REROUTE_TURN: readonly string[] = ["us-east", "eu-west", "asia-south"];

function mapAnomalyToFailure(kind: AnomalyKind): FailureKind {
  switch (kind) {
    case "turn_degradation":
      return "regional_turn_outage";
    case "signaling_latency_spike":
      return "signaling_region_failure";
    case "peer_disconnect_surge":
      return "partial_partition";
    case "yjs_lag_spike":
    case "chunk_failure_spike":
      return "partial_partition";
    default:
      return "partial_partition";
  }
}

export function detectAnomalies(obs: HealthObservation): AnomalyKind[] {
  const out: AnomalyKind[] = [];
  const t = obs.telemetry;
  if (t.yjsConvergenceP95Ms > 1200) out.push("yjs_lag_spike");
  if (t.chunkReliability < 0.995) out.push("chunk_failure_spike");
  if (obs.recentDisconnectRate > 0.05) out.push("peer_disconnect_surge");
  if (t.turnUsageRatio > 0.92 || obs.turnProbeFailureRate > 0.08)
    out.push("turn_degradation");
  if (t.webrtcLatency.p95 > 800) out.push("signaling_latency_spike");
  return out;
}

/**
 * Produce a bundled recovery decision. Golden peer for Yjs resync is chosen by ops hook;
 * here we pass null unless caller supplies healthiestPeerId.
 */
export function decideSelfHealing(
  obs: HealthObservation,
  ctx: {
    readonly healthiestPeerId?: string;
    readonly preferredTurnFailover?: readonly string[];
  } = {},
): SelfHealingDecision {
  const anomalies = detectAnomalies(obs);
  const primary = anomalies[0] ?? "peer_disconnect_surge";
  const mappedFailure = mapAnomalyToFailure(primary);
  const plan = recoveryPlanForFailure(mappedFailure);

  return {
    anomalies,
    mappedFailure,
    rerouteTurnRegions: ctx.preferredTurnFailover ?? [...DEFAULT_REROUTE_TURN],
    forceYjsResyncFromPeerId:
      plan.rerouteSignaling || primary === "yjs_lag_spike"
        ? ctx.healthiestPeerId ?? null
        : null,
    rebuildMesh:
      plan.rerouteTurn ||
      plan.rerouteSignaling ||
      primary === "peer_disconnect_surge",
    restartSignaling: plan.rerouteSignaling,
  };
}

export type TurnRerouteContext = {
  readonly endpoints: readonly TurnEndpoint[];
  readonly deadRegionHint?: string;
};

export type SignalingRestartContext = {
  readonly alternatives: readonly PeerRoutingDecision[];
  readonly deadRegion?: string;
};
