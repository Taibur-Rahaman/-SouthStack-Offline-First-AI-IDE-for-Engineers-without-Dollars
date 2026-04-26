/**
 * Global signaling mesh: multi-region WebSocket edges + logical fanout bus (Redis/NATS).
 * Stateless edge design; shared-nothing processes behind regional L4/L7 load balancers.
 */

export type SignalingRegionId = "us-east" | "eu-west" | "asia-south" | string;

export type FanoutBackend = "redis" | "nats";

export interface SignalingNodeDescriptor {
  readonly region: SignalingRegionId;
  readonly publicWsUrl: string;
  readonly weight: number;
  readonly healthy: boolean;
}

export interface GlobalSignalingMeshSpec {
  readonly regions: readonly SignalingNodeDescriptor[];
  readonly fanout: FanoutBackend;
  /** Redis cluster URL ref or NATS leaf cluster — deployment injects. */
  readonly fanoutConnectionRef: string;
  readonly roomTopicPrefix: string;
}

export interface PeerRoutingDecision {
  readonly chosenRegion: SignalingRegionId;
  readonly wsUrl: string;
  readonly reason: "latency" | "capacity" | "failover";
}

export interface LatencySample {
  readonly region: SignalingRegionId;
  readonly rttMs: number;
}

/**
 * Pick lowest-latency healthy signaling edge; exclude unhealthy, apply weights as soft bias.
 */
export function selectSignalingNode(
  nodes: readonly SignalingNodeDescriptor[],
  samples: readonly LatencySample[],
): PeerRoutingDecision | null {
  const sampleMap = new Map(samples.map((s) => [s.region, s.rttMs] as const));
  const candidates = nodes.filter((n) => n.healthy);
  if (candidates.length === 0) return null;

  let best: SignalingNodeDescriptor | undefined;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const n of candidates) {
    const rtt = sampleMap.get(n.region) ?? 500;
    const score = rtt / Math.max(n.weight, 0.001);
    if (score < bestScore) {
      bestScore = score;
      best = n;
    }
  }
  if (!best) return null;
  return {
    chosenRegion: best.region,
    wsUrl: best.publicWsUrl,
    reason: "latency",
  };
}

/** Topic name for room-scoped fanout (Redis pub/sub or NATS subject). */
export function roomFanoutSubject(
  spec: GlobalSignalingMeshSpec,
  roomId: string,
): string {
  const safe = roomId.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${spec.roomTopicPrefix}${safe}`;
}

/**
 * Document how a stateless edge publishes to the bus (implementation lives in ops).
 */
export interface FanoutPublishEnvelope {
  readonly roomId: string;
  readonly region: SignalingRegionId;
  readonly traceId: string;
  readonly payload: Uint8Array;
}

export function describeMeshForOperations(
  spec: GlobalSignalingMeshSpec,
): string {
  return [
    `fanout=${spec.fanout}`,
    `connection=${spec.fanoutConnectionRef}`,
    `regions=${spec.regions.map((r) => r.region).join(",")}`,
  ].join(" ");
}
