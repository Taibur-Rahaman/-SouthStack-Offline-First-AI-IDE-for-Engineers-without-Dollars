/**
 * Self-writing feature proposals: declarative UI diffs + versioned CRDT patch descriptors.
 * No runtime code injection — payloads are references or structured ops bound by app adapters.
 */

export type ModuleRef =
  | "builder"
  | "agents"
  | "image_pipeline"
  | "chunk_transfer"
  | "awareness"
  | string;

/** Structural UI change ops (consumers map to concrete components). */
export type UiDiffOp =
  | { readonly kind: "add_component"; readonly componentKey: string; readonly propsRef: string }
  | { readonly kind: "reorder"; readonly parentKey: string; readonly order: readonly string[] }
  | { readonly kind: "wire_interaction"; readonly from: string; readonly to: string }
  | { readonly kind: "agent_tool_register"; readonly toolId: string; readonly schemaRef: string };

export interface UiDiff {
  readonly version: number;
  readonly operations: readonly UiDiffOp[];
}

/**
 * Serializable CRDT patch envelope — actual Yjs update bytes live in artifact store keyed by ref.
 */
export interface CrdtPatchDescriptor {
  readonly schemaEpoch: number;
  readonly mergeKey: string;
  readonly updatePayloadRef: string;
  readonly preconditionHash: string;
}

export interface FeatureProposal {
  readonly id: string;
  readonly description: string;
  readonly affectedModules: readonly ModuleRef[];
  readonly uiDiff: UiDiff;
  readonly crdtPatch: CrdtPatchDescriptor;
  readonly riskScore: number;
  readonly simulationRequired: true;
}

export interface FeatureGeneratorInput {
  readonly intent: string;
  readonly seed: number;
}

function mulberry32(seed: number): () => number {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic stub generator for CI — replace with agent/LLM bridge in product wiring. */
export function generateFeatureProposal(input: FeatureGeneratorInput): FeatureProposal {
  const rng = mulberry32(input.seed);
  const id = `feat_${Math.floor(rng() * 1e9).toString(36)}`;
  const riskScore = Math.round(rng() * 100) / 100;

  return {
    id,
    description: input.intent.slice(0, 500),
    affectedModules: ["builder", "agents"],
    uiDiff: {
      version: 1,
      operations: [
        {
          kind: "add_component",
          componentKey: `dynamic.panel.${id}`,
          propsRef: `props/${id}.json`,
        },
        {
          kind: "wire_interaction",
          from: `dynamic.panel.${id}`,
          to: "agent.submitTool",
        },
      ],
    },
    crdtPatch: {
      schemaEpoch: 1,
      mergeKey: `evo:${id}`,
      updatePayloadRef: `artifacts/yjs/${id}.yupdate`,
      preconditionHash: `sha256:pre:${id}`,
    },
    riskScore,
    simulationRequired: true,
  };
}
