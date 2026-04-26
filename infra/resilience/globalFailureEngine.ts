/**
 * Real-world failure simulation & recovery policies for global real-time infra.
 * Guarantees stated here are operational targets enforced by reroute + CRDT semantics (app-side eventual consistency).
 */

import type { TurnEndpoint } from "../turn/turnLoadBalancer";
import type { PeerRoutingDecision } from "../signaling/globalSignalingMesh";

export type FailureKind =
  | "regional_turn_outage"
  | "signaling_region_failure"
  | "partial_partition"
  | "dns_propagation_delay"
  | "nat_rebinding_loss";

export interface FailureEvent {
  readonly kind: FailureKind;
  readonly region: string;
  readonly startedAtMs: number;
  readonly expectedDurationMs: number;
}

export interface RecoveryAction {
  readonly rerouteTurn: boolean;
  readonly rerouteSignaling: boolean;
  readonly widenIceRetry: boolean;
  readonly awarenessResync: boolean;
}

export function recoveryPlanForFailure(kind: FailureKind): RecoveryAction {
  switch (kind) {
    case "regional_turn_outage":
      return {
        rerouteTurn: true,
        rerouteSignaling: false,
        widenIceRetry: true,
        awarenessResync: true,
      };
    case "signaling_region_failure":
      return {
        rerouteTurn: false,
        rerouteSignaling: true,
        widenIceRetry: false,
        awarenessResync: true,
      };
    case "partial_partition":
      return {
        rerouteTurn: true,
        rerouteSignaling: true,
        widenIceRetry: true,
        awarenessResync: true,
      };
    case "dns_propagation_delay":
      return {
        rerouteTurn: false,
        rerouteSignaling: false,
        widenIceRetry: true,
        awarenessResync: false,
      };
    case "nat_rebinding_loss":
      return {
        rerouteTurn: true,
        rerouteSignaling: false,
        widenIceRetry: true,
        awarenessResync: true,
      };
    default:
      return {
        rerouteTurn: true,
        rerouteSignaling: true,
        widenIceRetry: true,
        awarenessResync: true,
      };
  }
}

/** Drop endpoints for unhealthy region; infra rotates ICE list order client-side. */
export function rerouteTurnEndpoints(
  endpoints: readonly TurnEndpoint[],
  deadRegion: string,
): TurnEndpoint[] {
  return endpoints.filter((e) => e.region !== deadRegion);
}

export function rerouteSignaling(
  alternatives: readonly PeerRoutingDecision[],
  deadRegion: string,
): PeerRoutingDecision | undefined {
  return alternatives.find((a) => a.chosenRegion !== deadRegion);
}

export interface GuaranteeChecklist {
  readonly automaticRerouting: boolean;
  readonly noSessionLossIntent: boolean;
  readonly eventualYjsConvergence: boolean;
  readonly awarenessRecovery: boolean;
}

export function guaranteesForPlan(plan: RecoveryAction): GuaranteeChecklist {
  return {
    automaticRerouting: plan.rerouteTurn || plan.rerouteSignaling || plan.widenIceRetry,
    noSessionLossIntent: plan.rerouteSignaling || plan.widenIceRetry,
    eventualYjsConvergence: true,
    awarenessRecovery: plan.awarenessResync,
  };
}
