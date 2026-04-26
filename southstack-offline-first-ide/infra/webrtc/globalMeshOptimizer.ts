/**
 * Hybrid mesh topology planner: local dense mesh + relay-assisted distant links + optional supernodes.
 * Produces connection budgets and roles without modifying WebRTCMesh implementation.
 */

export type PeerId = string;

export interface PeerNetProfile {
  readonly id: PeerId;
  readonly region: string;
  readonly measuredRttMs: number;
  readonly isMobile: boolean;
}

export type MeshRole = "mesh" | "relay-only" | "supernode";

export interface MeshEdge {
  readonly a: PeerId;
  readonly b: PeerId;
  readonly mode: "p2p" | "turn-relay";
  readonly reason: string;
}

export interface HybridMeshPlan {
  readonly localClusters: readonly (readonly PeerId[])[];
  readonly edges: readonly MeshEdge[];
  readonly roles: ReadonlyMap<PeerId, MeshRole>;
  readonly relayBudget: number;
}

export interface HybridMeshOptimizerOptions {
  /** Max simultaneous mesh adjacencies per peer (reduces explosion). */
  readonly maxMeshDegree: number;
  /** RTT threshold (ms): peers closer form local mesh. */
  readonly localClusterRttMs: number;
  /** When estimated mesh density exceeds this, shift some peers to relay-only. */
  readonly densitySoftCap: number;
  /** Fraction [0,1] of peers promoted to supernode candidates (stable desktops). */
  readonly supernodeRatio: number;
}

const DEFAULT_OPTIONS: HybridMeshOptimizerOptions = {
  maxMeshDegree: 8,
  localClusterRttMs: 80,
  densitySoftCap: 48,
  supernodeRatio: 0.08,
};

/**
 * Greedy clustering by latency; cap degree; insert TURN-backed edges for distant region pairs when needed.
 */
export function planHybridMesh(
  peers: readonly PeerNetProfile[],
  options: Partial<HybridMeshOptimizerOptions> = {},
): HybridMeshPlan {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const sorted = [...peers].sort((x, y) => x.measuredRttMs - y.measuredRttMs);

  const clusters = clusterByLatency(sorted, opts.localClusterRttMs);
  const roles = assignRoles(sorted, opts);
  const edges: MeshEdge[] = [];
  let relayBudget = 0;

  for (const cluster of clusters) {
    edges.push(...meshWithinCluster(cluster, opts.maxMeshDegree, roles));
  }

  const density = estimateDensity(peers.length, opts.maxMeshDegree);
  if (density > opts.densitySoftCap) {
    const overflow = peers.filter((p) => roles.get(p.id) === "relay-only");
    for (const p of overflow) {
      const anchor = pickSupernodeForPeer(peers, p, roles);
      if (anchor && anchor !== p.id) {
        edges.push({
          a: p.id,
          b: anchor,
          mode: "turn-relay",
          reason: "density_cap_relay",
        });
        relayBudget++;
      }
    }
  }

  return {
    localClusters: clusters,
    edges,
    roles,
    relayBudget,
  };
}

function clusterByLatency(
  sorted: PeerNetProfile[],
  thresholdMs: number,
): PeerId[][] {
  if (sorted.length === 0) return [];
  const clusters: PeerId[][] = [];
  let current: PeerId[] = [sorted[0].id];
  let anchorRtt = sorted[0].measuredRttMs;

  for (let i = 1; i < sorted.length; i++) {
    const p = sorted[i];
    if (Math.abs(p.measuredRttMs - anchorRtt) <= thresholdMs) {
      current.push(p.id);
    } else {
      clusters.push(current);
      current = [p.id];
      anchorRtt = p.measuredRttMs;
    }
  }
  clusters.push(current);
  return clusters;
}

function assignRoles(
  peers: PeerNetProfile[],
  opts: HybridMeshOptimizerOptions,
): Map<PeerId, MeshRole> {
  const roles = new Map<PeerId, MeshRole>();
  const superCount = Math.max(1, Math.floor(peers.length * opts.supernodeRatio));

  const desktop = peers.filter((p) => !p.isMobile);
  for (let i = 0; i < desktop.length; i++) {
    roles.set(desktop[i].id, i < superCount ? "supernode" : "mesh");
  }
  for (const p of peers) {
    if (!roles.has(p.id)) roles.set(p.id, "mesh");
  }

  if (estimateDensity(peers.length, opts.maxMeshDegree) > opts.densitySoftCap) {
    let n = 0;
    for (const p of peers) {
      if (p.isMobile && n % 2 === 0) {
        roles.set(p.id, "relay-only");
        n++;
      }
    }
  }
  return roles;
}

function meshWithinCluster(
  cluster: readonly PeerId[],
  maxDegree: number,
  roles: ReadonlyMap<PeerId, MeshRole>,
): MeshEdge[] {
  const edges: MeshEdge[] = [];
  const degree = new Map<PeerId, number>();
  for (const id of cluster) degree.set(id, 0);

  for (let i = 0; i < cluster.length; i++) {
    for (let j = i + 1; j < cluster.length; j++) {
      const a = cluster[i];
      const b = cluster[j];
      if ((degree.get(a) ?? 0) >= maxDegree || (degree.get(b) ?? 0) >= maxDegree)
        continue;
      if (roles.get(a) === "relay-only" || roles.get(b) === "relay-only")
        continue;

      edges.push({
        a,
        b,
        mode: "p2p",
        reason: "local_mesh",
      });
      degree.set(a, (degree.get(a) ?? 0) + 1);
      degree.set(b, (degree.get(b) ?? 0) + 1);
    }
  }
  return edges;
}

function estimateDensity(peerCount: number, maxDegree: number): number {
  if (peerCount <= 1) return 0;
  return (peerCount * maxDegree) / 2;
}

function pickSupernodeForPeer(
  all: readonly PeerNetProfile[],
  peer: PeerNetProfile,
  roles: ReadonlyMap<PeerId, MeshRole>,
): PeerId | undefined {
  const supers = all.filter((p) => roles.get(p.id) === "supernode" && p.id !== peer.id);
  if (supers.length === 0) return undefined;
  supers.sort(
    (x, y) =>
      Math.abs(x.measuredRttMs - peer.measuredRttMs) -
      Math.abs(y.measuredRttMs - peer.measuredRttMs),
  );
  return supers[0]?.id;
}
