/**
 * Evolution history DAG + rollback anchors + what-if branches (declarative only).
 */

export interface EvolutionVertex {
  readonly id: string;
  readonly parentId: string | null;
  readonly schemaEpoch: number;
  readonly featureId: string;
  readonly label: string;
}

export interface EvolutionBranch {
  readonly name: string;
  readonly tipVertexId: string;
}

export interface EvolutionHistoryGraph {
  readonly vertices: readonly EvolutionVertex[];
  readonly branches: readonly EvolutionBranch[];
}

export function appendEvolutionStep(
  graph: EvolutionHistoryGraph,
  step: Omit<EvolutionVertex, "id"> & { readonly id?: string },
): EvolutionHistoryGraph {
  const id = step.id ?? `v_${graph.vertices.length + 1}`;
  const vertex: EvolutionVertex = {
    id,
    parentId: step.parentId,
    schemaEpoch: step.schemaEpoch,
    featureId: step.featureId,
    label: step.label,
  };
  return {
    vertices: [...graph.vertices, vertex],
    branches: graph.branches,
  };
}

export function lineageToRoot(
  graph: EvolutionHistoryGraph,
  vertexId: string,
): EvolutionVertex[] {
  const byId = new Map(graph.vertices.map((v) => [v.id, v] as const));
  const chain: EvolutionVertex[] = [];
  let cur: EvolutionVertex | undefined = byId.get(vertexId);
  while (cur) {
    chain.push(cur);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return chain;
}

export function rollbackTargetEpoch(
  graph: EvolutionHistoryGraph,
  vertexId: string,
): number | null {
  const chain = lineageToRoot(graph, vertexId);
  const tip = chain[0];
  return tip ? tip.schemaEpoch : null;
}

export function branchWhatIf(
  base: EvolutionHistoryGraph,
  forkName: string,
  newTip: Omit<EvolutionVertex, "id"> & { readonly id: string },
): EvolutionHistoryGraph {
  const extended = appendEvolutionStep(base, newTip);
  return {
    vertices: extended.vertices,
    branches: [...extended.branches, { name: forkName, tipVertexId: newTip.id }],
  };
}
