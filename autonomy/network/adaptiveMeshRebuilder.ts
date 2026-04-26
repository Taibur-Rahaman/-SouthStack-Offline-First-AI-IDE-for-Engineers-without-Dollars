/**
 * Adaptive topology reconfiguration: continuously maps measured RTT graph to hybrid mesh plans.
 * Delegates geometry to infra mesh optimizer; adds mode selection (full | partial | relay-assisted).
 */

import {
  planHybridMesh,
  type HybridMeshPlan,
  type PeerNetProfile,
  type HybridMeshOptimizerOptions,
} from "../../infra/webrtc/globalMeshOptimizer";

export type TopologyMode = "full_mesh" | "partial_mesh" | "relay_assisted";

export interface AdaptiveMeshState {
  readonly mode: TopologyMode;
  readonly plan: HybridMeshPlan;
  readonly tickId: number;
}

export interface AdaptiveRebuilderInput {
  readonly peers: readonly PeerNetProfile[];
  readonly optimizer: Partial<HybridMeshOptimizerOptions>;
  /** Rising edge density triggers relay-assisted bias. */
  readonly peerCountSoftLimit: number;
}

function chooseMode(peerCount: number, relayBudget: number, softLimit: number): TopologyMode {
  if (peerCount <= 12) return "full_mesh";
  if (peerCount > softLimit || relayBudget > peerCount * 0.15) return "relay_assisted";
  return "partial_mesh";
}

/**
 * Single adaptation step: replan hybrid mesh from fresh latency samples.
 */
export function rebuildAdaptiveMesh(
  input: AdaptiveMeshState | null,
  data: AdaptiveRebuilderInput,
): AdaptiveMeshState {
  const softLimit = data.peerCountSoftLimit > 0 ? data.peerCountSoftLimit : 500;
  const plan = planHybridMesh(data.peers, data.optimizer);
  const mode = chooseMode(data.peers.length, plan.relayBudget, softLimit);
  const tickId = (input?.tickId ?? 0) + 1;
  return { mode, plan, tickId };
}
