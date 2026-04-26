/**
 * Safe autonomous deployment loop: generate → simulate → merge validate → deploy descriptor → monitor → rollback hook.
 */

import type { FeatureProposal } from "../selfWriting/featureGenerator";
import { generateFeatureProposal } from "../selfWriting/featureGenerator";
import { simulateFeature } from "../sandbox/featureSimulationEngine";
import { mergeFeatureProposals } from "../merge/crdtFeatureMerger";
import { appendEvolutionStep, type EvolutionHistoryGraph } from "../versioning/evolutionHistoryGraph";

export type DeploymentPhase =
  | "generate"
  | "simulate"
  | "merge_validate"
  | "deploy_patch"
  | "monitor"
  | "rollback";

export interface DeploymentLoopInput {
  readonly intent: string;
  readonly seed: number;
  readonly currentSchemaEpoch: number;
  readonly history: EvolutionHistoryGraph;
}

export interface DeploymentLoopOutcome {
  readonly phase: DeploymentPhase;
  readonly proposal?: FeatureProposal;
  readonly deployed: boolean;
  readonly stable: boolean;
  readonly history: EvolutionHistoryGraph;
}

export interface MonitorSignal {
  readonly instability01: number;
}

/**
 * Single pass through the loop — callers advance ticks and feed post-deploy MonitorSignal.
 */
export function runAutonomousDeploymentPass(
  input: DeploymentLoopInput,
  postDeployMonitor?: MonitorSignal,
): DeploymentLoopOutcome {
  const proposal = generateFeatureProposal({ intent: input.intent, seed: input.seed });
  const sim = simulateFeature(proposal);
  if (!sim.approved) {
    return {
      phase: "simulate",
      proposal,
      deployed: false,
      stable: false,
      history: input.history,
    };
  }

  const merge = mergeFeatureProposals(input.currentSchemaEpoch, [proposal]);
  if (!merge.ok) {
    return {
      phase: "merge_validate",
      proposal,
      deployed: false,
      stable: false,
      history: input.history,
    };
  }

  const hist = appendEvolutionStep(input.history, {
    parentId: input.history.vertices[input.history.vertices.length - 1]?.id ?? null,
    schemaEpoch: merge.plan.resultingSchemaEpoch,
    featureId: proposal.id,
    label: proposal.description.slice(0, 120),
  });

  if (!postDeployMonitor) {
    return {
      phase: "deploy_patch",
      proposal,
      deployed: true,
      stable: true,
      history: hist,
    };
  }

  const unstable = postDeployMonitor.instability01 > 0.35;
  return {
    phase: unstable ? "rollback" : "monitor",
    proposal,
    deployed: true,
    stable: !unstable,
    history: unstable ? input.history : hist,
  };
}
