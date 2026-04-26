/**
 * Dynamic peer role assignment for coordination overlays (relay, sync leader, chunk, awareness).
 * Outputs roles for coordinator — does not change wire protocols.
 */

import type { PeerNetProfile, MeshRole } from "../../infra/webrtc/globalMeshOptimizer";

export type CoordinationRole =
  | "relay_peer"
  | "sync_leader"
  | "chunk_distributor"
  | "awareness_anchor";

export interface RoleAssignment {
  readonly peerId: string;
  readonly role: CoordinationRole;
  readonly priority: number;
}

export interface OrchestratorInput {
  readonly peers: readonly PeerNetProfile[];
  readonly meshRoles: ReadonlyMap<string, MeshRole>;
  readonly chunkLoad01: ReadonlyMap<string, number>;
  readonly awarenessFanout01: ReadonlyMap<string, number>;
}

function scorePeer(p: PeerNetProfile, meshRole: MeshRole | undefined): number {
  let s = 1 / (1 + p.measuredRttMs / 200);
  if (meshRole === "supernode") s += 0.25;
  if (!p.isMobile) s += 0.15;
  return s;
}

export function assignCoordinationRoles(input: OrchestratorInput): RoleAssignment[] {
  const out: RoleAssignment[] = [];
  if (input.peers.length === 0) return out;

  const ranked = [...input.peers].sort(
    (a, b) =>
      scorePeer(b, input.meshRoles.get(b.id)) -
      scorePeer(a, input.meshRoles.get(a.id)),
  );

  const syncLeader = ranked[0];
  out.push({ peerId: syncLeader.id, role: "sync_leader", priority: 100 });

  const relay = ranked.find((p) => input.meshRoles.get(p.id) === "supernode") ?? ranked[1] ?? ranked[0];
  out.push({ peerId: relay.id, role: "relay_peer", priority: 90 });

  let bestChunk = ranked[0];
  let bestChunkScore = -1;
  for (const p of ranked) {
    const load = input.chunkLoad01.get(p.id) ?? 0;
    const s = scorePeer(p, input.meshRoles.get(p.id)) * (1 - load);
    if (s > bestChunkScore) {
      bestChunkScore = s;
      bestChunk = p;
    }
  }
  out.push({ peerId: bestChunk.id, role: "chunk_distributor", priority: 80 });

  let bestAware = ranked[0];
  let bestAwareScore = -1;
  for (const p of ranked) {
    const fan = input.awarenessFanout01.get(p.id) ?? 0;
    const s = scorePeer(p, input.meshRoles.get(p.id)) * (1 + fan * 0.1);
    if (s > bestAwareScore) {
      bestAwareScore = s;
      bestAware = p;
    }
  }
  out.push({ peerId: bestAware.id, role: "awareness_anchor", priority: 70 });

  return out;
}
