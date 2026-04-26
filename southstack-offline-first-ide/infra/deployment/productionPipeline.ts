/**
 * Multi-region deployment pipeline blueprint: CI/CD phases, canary, rollback, feature gates.
 */

export type RegionDeployTarget = "us-east" | "eu-west" | "asia-south" | string;

export interface DeployArtifact {
  readonly imageDigest: string;
  readonly gitSha: string;
}

export interface CanarySpec {
  readonly regions: readonly RegionDeployTarget[];
  readonly trafficPercent: number;
  readonly successCriteria: {
    readonly maxErrorRate: number;
    readonly minPeerJoinSuccess: number;
  };
}

export interface ProductionPipelineSpec {
  readonly stages: readonly ("build" | "scan" | "staging" | "canary" | "promote")[];
  readonly canary: CanarySpec;
  readonly rollbackOnViolation: boolean;
}

export interface FeatureFlagState {
  readonly chunkSystem: boolean;
  readonly agentSystem: boolean;
  readonly imagePipeline: boolean;
}

export const DEFAULT_FEATURE_FLAGS: FeatureFlagState = {
  chunkSystem: true,
  agentSystem: true,
  imagePipeline: true,
};

export interface RollbackTrigger {
  readonly reason: string;
  readonly revertToDigest: string;
}

export function buildPipelinePlan(spec: ProductionPipelineSpec): string[] {
  const lines: string[] = [];
  for (const s of spec.stages) {
    lines.push(`stage:${s}`);
    if (s === "canary") {
      lines.push(
        `canary_regions=${spec.canary.regions.join(",")}`,
        `canary_pct=${spec.canary.trafficPercent}`,
      );
    }
  }
  lines.push(`rollback=${spec.rollbackOnViolation}`);
  return lines;
}

export function evaluateCanary(
  metrics: { errorRate: number; peerJoinSuccess: number },
  spec: CanarySpec,
): "promote" | "hold" | "rollback" {
  if (metrics.errorRate > spec.successCriteria.maxErrorRate) return "rollback";
  if (metrics.peerJoinSuccess < spec.successCriteria.minPeerJoinSuccess)
    return "hold";
  return "promote";
}

export function gateFeatures(
  flags: FeatureFlagState,
  env: "staging" | "production",
): FeatureFlagState {
  if (env === "staging") return flags;
  return {
    chunkSystem: flags.chunkSystem,
    agentSystem: flags.agentSystem,
    imagePipeline: flags.imagePipeline,
  };
}
