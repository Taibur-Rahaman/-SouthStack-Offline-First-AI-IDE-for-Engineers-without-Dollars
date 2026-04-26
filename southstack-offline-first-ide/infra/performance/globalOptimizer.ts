/**
 * Global performance tuning policies (connection graph, retries, awareness, Yjs compression hints).
 */

export interface GraphDensityPolicy {
  readonly maxEdgesPerPeer: number;
  readonly targetClusterSize: number;
}

export interface ChunkRetryPolicy {
  readonly baseBackoffMs: number;
  readonly maxBackoffMs: number;
  readonly lossThreshold: number;
}

export interface AwarenessThrottlePolicy {
  readonly minIntervalMs: number;
  readonly maxUpdatesPerSecond: number;
}

export interface YjsCompressionHint {
  readonly enableUpdateBundle: boolean;
  readonly bundleWindowMs: number;
}

export interface GlobalOptimizerBundle {
  readonly graph: GraphDensityPolicy;
  readonly chunkRetry: ChunkRetryPolicy;
  readonly awareness: AwarenessThrottlePolicy;
  readonly yjs: YjsCompressionHint;
}

export const DEFAULT_GLOBAL_OPTIMIZER: GlobalOptimizerBundle = {
  graph: { maxEdgesPerPeer: 8, targetClusterSize: 24 },
  chunkRetry: {
    baseBackoffMs: 50,
    maxBackoffMs: 2000,
    lossThreshold: 0.05,
  },
  awareness: { minIntervalMs: 50, maxUpdatesPerSecond: 20 },
  yjs: { enableUpdateBundle: true, bundleWindowMs: 16 },
};

export function backoffMsForAttempt(
  attempt: number,
  policy: ChunkRetryPolicy,
  packetLoss: number,
): number {
  if (packetLoss < policy.lossThreshold) return policy.baseBackoffMs;
  const exp = Math.min(
    policy.maxBackoffMs,
    policy.baseBackoffMs * 2 ** Math.min(attempt, 8),
  );
  return exp;
}

export function awarenessAllowed(
  lastEmitMs: number,
  nowMs: number,
  policy: AwarenessThrottlePolicy,
): boolean {
  return nowMs - lastEmitMs >= policy.minIntervalMs;
}

export function shouldBundleYjsUpdate(
  pendingBytes: number,
  pendingAgeMs: number,
  hint: YjsCompressionHint,
): boolean {
  if (!hint.enableUpdateBundle) return false;
  return pendingAgeMs >= hint.bundleWindowMs && pendingBytes > 256;
}
