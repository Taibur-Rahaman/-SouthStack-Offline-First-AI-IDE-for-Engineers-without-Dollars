/**
 * Region-aware TURN selection, failover, and latency-based routing.
 * Pure infrastructure policy — clients consume resulting ICE server list order.
 */

import type { CoturnRegionNode, TurnRegionId } from "./turnClusterConfig";

export interface RegionProbeResult {
  readonly region: TurnRegionId;
  readonly rttMs: number;
  readonly packetLoss: number;
  readonly healthy: boolean;
}

export interface TurnEndpoint {
  readonly region: TurnRegionId;
  readonly urls: readonly string[];
  readonly username: string;
  readonly credential: string;
  readonly priority: number;
}

export interface TurnSelectionOptions {
  readonly fallbackRouting: boolean;
  readonly latencyBasedSelection: boolean;
  /** When primary regions fail health checks, try these in order. */
  readonly failoverOrder?: readonly TurnRegionId[];
}

/**
 * Sort probes by latency when enabled; unhealthy regions sink to bottom.
 */
export function rankRegionsByLatency(
  probes: readonly RegionProbeResult[],
  latencyBasedSelection: boolean,
): RegionProbeResult[] {
  const copy = [...probes];
  if (!latencyBasedSelection) {
    return copy.sort((a, b) => Number(b.healthy) - Number(a.healthy));
  }
  return copy.sort((a, b) => {
    if (a.healthy !== b.healthy) return Number(b.healthy) - Number(a.healthy);
    return a.rttMs - b.rttMs;
  });
}

/**
 * Build ICE server entries for coturn nodes: STUN + TURNS + turn: TCP fallback.
 */
export function buildTurnUrlsForNode(node: CoturnRegionNode, tlsPort: number): string[] {
  const host = node.externalHostname;
  return [
    `stun:${host}:3478`,
    `turns:${host}:${tlsPort}?transport=tcp`,
    `turn:${host}:3478?transport=udp`,
    `turn:${host}:3478?transport=tcp`,
  ];
}

/**
 * Select ordered TURN endpoints for a peer: lowest latency first, failover preserved.
 */
export function selectTurnEndpoints(
  nodes: readonly CoturnRegionNode[],
  probes: readonly RegionProbeResult[],
  credentials: { username: string; credential: string },
  tlsPort: number,
  options: TurnSelectionOptions,
): TurnEndpoint[] {
  const ranked = rankRegionsByLatency(probes, options.latencyBasedSelection);
  const regionOrder =
    options.fallbackRouting && options.failoverOrder?.length
      ? mergeFailoverOrder(ranked, options.failoverOrder)
      : ranked;

  const byRegion = new Map(nodes.map((n) => [n.region, n] as const));
  const out: TurnEndpoint[] = [];
  let priority = 100;
  for (const p of regionOrder) {
    const node = byRegion.get(p.region);
    if (!node || !p.healthy) continue;
    out.push({
      region: p.region,
      urls: buildTurnUrlsForNode(node, tlsPort),
      username: credentials.username,
      credential: credentials.credential,
      priority: priority--,
    });
  }
  if (options.fallbackRouting) {
    for (const p of regionOrder) {
      const node = byRegion.get(p.region);
      if (!node || p.healthy) continue;
      out.push({
        region: p.region,
        urls: buildTurnUrlsForNode(node, tlsPort),
        username: credentials.username,
        credential: credentials.credential,
        priority: priority--,
      });
    }
  }
  return out;
}

function mergeFailoverOrder(
  ranked: readonly RegionProbeResult[],
  failoverOrder: readonly TurnRegionId[],
): RegionProbeResult[] {
  const map = new Map(ranked.map((r) => [r.region, r] as const));
  const primary: RegionProbeResult[] = [];
  for (const id of failoverOrder) {
    const hit = map.get(id);
    if (hit) primary.push(hit);
  }
  const rest = ranked.filter((r) => !failoverOrder.includes(r.region));
  return [...primary, ...rest];
}
