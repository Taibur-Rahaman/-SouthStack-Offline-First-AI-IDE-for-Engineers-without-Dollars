/**
 * Continuous optimization: tunes infra performance bundle from rolling telemetry (stability-first).
 */

import {
  DEFAULT_GLOBAL_OPTIMIZER,
  type GlobalOptimizerBundle,
  type ChunkRetryPolicy,
  type AwarenessThrottlePolicy,
  type YjsCompressionHint,
  type GraphDensityPolicy,
  backoffMsForAttempt,
} from "../../infra/performance/globalOptimizer";
import type { GlobalTelemetrySnapshot } from "../../infra/observability/globalTelemetry";

export interface OptimizerState {
  readonly bundle: GlobalOptimizerBundle;
}

export function adjustBundleFromTelemetry(
  current: OptimizerState,
  snapshot: GlobalTelemetrySnapshot,
): GlobalOptimizerBundle {
  const base = current.bundle;
  const highLag =
    snapshot.yjsConvergenceP95Ms > 900 || snapshot.awarenessPropagationP95Ms > 800;
  const lossy = snapshot.chunkReliability < 0.998;
  const denseTurn = snapshot.turnUsageRatio > 0.75;

  const graph: GraphDensityPolicy = {
    maxEdgesPerPeer: Math.max(
      4,
      Math.min(12, base.graph.maxEdgesPerPeer + (denseTurn ? -1 : 0)),
    ),
    targetClusterSize: Math.max(
      12,
      Math.min(40, base.graph.targetClusterSize + (highLag ? 4 : 0)),
    ),
  };

  const chunkRetry: ChunkRetryPolicy = {
    baseBackoffMs: lossy
      ? Math.min(120, base.chunkRetry.baseBackoffMs + 10)
      : Math.max(40, base.chunkRetry.baseBackoffMs - 5),
    maxBackoffMs: base.chunkRetry.maxBackoffMs,
    lossThreshold: lossy ? base.chunkRetry.lossThreshold * 0.95 : base.chunkRetry.lossThreshold,
  };

  const awareness: AwarenessThrottlePolicy = {
    minIntervalMs: highLag
      ? Math.min(120, base.awareness.minIntervalMs + 10)
      : base.awareness.minIntervalMs,
    maxUpdatesPerSecond: highLag
      ? Math.max(8, base.awareness.maxUpdatesPerSecond - 2)
      : base.awareness.maxUpdatesPerSecond,
  };

  const yjs: YjsCompressionHint = {
    enableUpdateBundle: true,
    bundleWindowMs: highLag
      ? Math.min(48, base.yjs.bundleWindowMs + 4)
      : Math.max(12, base.yjs.bundleWindowMs - 2),
  };

  return { graph, chunkRetry, awareness, yjs };
}

export function mergeWithDefaults(partial: Partial<GlobalOptimizerBundle>): GlobalOptimizerBundle {
  return {
    graph: partial.graph ?? DEFAULT_GLOBAL_OPTIMIZER.graph,
    chunkRetry: partial.chunkRetry ?? DEFAULT_GLOBAL_OPTIMIZER.chunkRetry,
    awareness: partial.awareness ?? DEFAULT_GLOBAL_OPTIMIZER.awareness,
    yjs: partial.yjs ?? DEFAULT_GLOBAL_OPTIMIZER.yjs,
  };
}

export { backoffMsForAttempt };
