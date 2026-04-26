/**
 * Ordered, versioned merge of feature proposals into UI schema epoch — declarative safety gates only.
 */

import type { FeatureProposal } from "../selfWriting/featureGenerator";

export interface MergePlan {
  readonly orderedProposalIds: readonly string[];
  readonly resultingSchemaEpoch: number;
}

export interface MergeResult {
  readonly ok: boolean;
  readonly plan: MergePlan;
  readonly rejectionReason?: string;
}

export function proposalsCompatible(a: FeatureProposal, b: FeatureProposal): boolean {
  if (a.crdtPatch.schemaEpoch !== b.crdtPatch.schemaEpoch) return false;
  if (a.crdtPatch.mergeKey === b.crdtPatch.mergeKey) return false;
  return true;
}

export function mergeFeatureProposals(
  currentEpoch: number,
  proposals: readonly FeatureProposal[],
): MergeResult {
  if (proposals.length === 0) {
    return {
      ok: true,
      plan: { orderedProposalIds: [], resultingSchemaEpoch: currentEpoch },
    };
  }

  const sorted = [...proposals].sort((x, y) =>
    x.crdtPatch.mergeKey.localeCompare(y.crdtPatch.mergeKey),
  );

  for (let i = 0; i < sorted.length - 1; i++) {
    if (!proposalsCompatible(sorted[i], sorted[i + 1])) {
      return {
        ok: false,
        plan: {
          orderedProposalIds: sorted.map((p) => p.id),
          resultingSchemaEpoch: currentEpoch,
        },
        rejectionReason: "non_commutative_or_epoch_mismatch",
      };
    }
  }

  const epochBump = sorted.length;
  return {
    ok: true,
    plan: {
      orderedProposalIds: sorted.map((p) => p.id),
      resultingSchemaEpoch: currentEpoch + epochBump,
    },
  };
}
