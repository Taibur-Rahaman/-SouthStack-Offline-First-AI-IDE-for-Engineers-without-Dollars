/**
 * Self-modifying agent intents — always gated by simulation + CRDT merge validity.
 */

import type { FeatureProposal } from "../selfWriting/featureGenerator";
import { mergeFeatureProposals } from "../merge/crdtFeatureMerger";
import { simulateFeature } from "../sandbox/featureSimulationEngine";

export interface AgentBehaviorSchemaRef {
  readonly schemaId: string;
  readonly version: number;
}

export interface AgentSelfModifyRequest {
  readonly agentId: string;
  readonly proposedTools: readonly FeatureProposal[];
  readonly spawnChildTasks: readonly string[];
  readonly behaviorSchema: AgentBehaviorSchemaRef;
}

export interface SelfModifyResult {
  readonly accepted: readonly FeatureProposal[];
  readonly rejected: readonly string[];
}

export function validateAgentSelfModification(
  currentEpoch: number,
  req: AgentSelfModifyRequest,
): SelfModifyResult {
  const accepted: FeatureProposal[] = [];
  const rejected: string[] = [];

  for (const p of req.proposedTools) {
    const sim = simulateFeature(p);
    const merge = mergeFeatureProposals(currentEpoch, [...accepted, p]);
    if (sim.approved && merge.ok) {
      accepted.push(p);
    } else {
      rejected.push(p.id);
    }
  }

  if (req.spawnChildTasks.length > 50) {
    rejected.push("spawn_budget_exceeded");
  }

  return { accepted, rejected };
}
