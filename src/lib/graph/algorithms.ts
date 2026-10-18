import { displayName, type GEdge, type Graph, type ToolOutput } from "./types";

function adjacency(g: Graph, types?: string[]) {
  const adj = new Map<string, { to: string; e: GEdge }[]>();
  for (const n of g.nodes) adj.set(n.id, []);
  for (const e of g.edges) {
    if (types && types.length && !types.includes(e.type)) continue;
    adj.get(e.source)?.push({ to: e.target, e });
    adj.get(e.target)?.push({ to: e.source, e });
  }
  return adj;
}

const nameOf = (g: Graph, id: string) => {
  const n = g.nodes.find((x) => x.id === id);
  return n ? displayName(n) : id;
};

/** Unweighted shortest path (BFS, undirected). */
export function shortestPath(g: Graph, from: string, to: string): ToolOutput {
  const t0 = performance.now();
  const adj = adjacency(g);
  const prev = new Map<string, { id: string; e: GEdge } | null>([[from, null]]);
  const queue = [from];
  let edgesTraversed = 0;
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur === to) break;
    for (const { to: nx, e } of adj.get(cur) ?? []) {
      edgesTraversed++;
      if (prev.has(nx)) continue;
      prev.set(nx, { id: cur, e });
      queue.push(nx);
    }
  }
  const nodeIds: string[] = [];
  const edgeIds: string[] = [];
  if (prev.has(to)) {
    let c: string | undefined = to;
    while (c) {
      nodeIds.unshift(c);
      const p = prev.get(c);
      if (p) edgeIds.unshift(p.e.id);
      c = p?.id;
    }
  }
  const edges = edgeIds.map((id) => g.edges.find((e) => e.id === id)!);
  return {
    table: {
      columns: ["hop", "from", "relationship", "to"],
      rows: edges.map((e, i) => [i + 1, nameOf(g, nodeIds[i]), e.type, nameOf(g, nodeIds[i + 1])]),
    },
    nodeIds,
    edgeIds,
    metrics: {
      ms: performance.now() - t0,
      nodesTouched: prev.size,
      edgesTraversed,
      depth: edgeIds.length,
      rows: edgeIds.length,
    },
  };
}

/** Brandes betweenness centrality (undirected, unweighted), normalized 0..1. */
export function betweenness(g: Graph): Map<string, number> {
  const adj = adjacency(g);
  const cb = new Map(g.nodes.map((n) => [n.id, 0]));
  for (const s of g.nodes.map((n) => n.id)) {
    const stack: string[] = [];
    const pred = new Map<string, string[]>();
    const sigma = new Map<string, number>([[s, 1]]);
    const dist = new Map<string, number>([[s, 0]]);
    const q = [s];
    while (q.length) {
      const v = q.shift()!;
      stack.push(v);
      for (const { to: w } of adj.get(v) ?? []) {
        if (!dist.has(w)) {
          dist.set(w, dist.get(v)! + 1);
          q.push(w);
        }
        if (dist.get(w) === dist.get(v)! + 1) {
          sigma.set(w, (sigma.get(w) ?? 0) + sigma.get(v)!);
          (pred.get(w) ?? pred.set(w, []).get(w)!).push(v);
        }
      }
    }
    const delta = new Map<string, number>();
    while (stack.length) {
      const w = stack.pop()!;
      for (const v of pred.get(w) ?? [])
        delta.set(v, (delta.get(v) ?? 0) + (sigma.get(v)! / sigma.get(w)!) * (1 + (delta.get(w) ?? 0)));
      if (w !== s) cb.set(w, cb.get(w)! + (delta.get(w) ?? 0));
    }
  }
  const n = g.nodes.length;
  const scale = n > 2 ? 1 / ((n - 1) * (n - 2)) : 1;
  for (const [k, v] of cb) cb.set(k, v * scale);
  return cb;
}

export function centrality(g: Graph, top = 5): ToolOutput {
  const t0 = performance.now();
  const bc = betweenness(g);
  const deg = new Map<string, number>();
  for (const e of g.edges) {
    deg.set(e.source, (deg.get(e.source) ?? 0) + 1);
    deg.set(e.target, (deg.get(e.target) ?? 0) + 1);
  }
  const ranked = [...bc.entries()].sort((a, b) => b[1] - a[1]).slice(0, top);
  return {
    table: {
      columns: ["rank", "node", "label", "betweenness", "degree"],
      rows: ranked.map(([id, v], i) => [
        i + 1,
        nameOf(g, id),
        g.nodes.find((n) => n.id === id)?.label,
        Number(v.toFixed(4)),
        deg.get(id) ?? 0,
      ]),
    },
    nodeIds: ranked.map(([id]) => id),
    edgeIds: [],
    metrics: {
      ms: performance.now() - t0,
      nodesTouched: g.nodes.length,
      edgesTraversed: g.edges.length * g.nodes.length * 2,
      depth: 0,
      rows: ranked.length,
    },
  };
}

/** Weakly connected components restricted to the given relationship types. */
export function components(g: Graph, types: string[] = []): ToolOutput & { groups: string[][] } {
  const t0 = performance.now();
  const adj = adjacency(g, types);
  const seen = new Set<string>();
  const groups: string[][] = [];
  let edgesTraversed = 0;
  for (const n of g.nodes) {
    if (seen.has(n.id) || (adj.get(n.id)?.length ?? 0) === 0) continue;
    const comp: string[] = [];
    const q = [n.id];
    seen.add(n.id);
    while (q.length) {
      const v = q.shift()!;
      comp.push(v);
      for (const { to } of adj.get(v) ?? []) {
        edgesTraversed++;
        if (!seen.has(to)) {
          seen.add(to);
          q.push(to);
        }
      }
    }
    groups.push(comp);
  }
  groups.sort((a, b) => b.length - a.length);
  const biggest = new Set(groups[0] ?? []);
  return {
    groups,
    table: {
      columns: ["component", "size", "members"],
      rows: groups.map((c, i) => [`C${i + 1}`, c.length, c.map((id) => nameOf(g, id)).join(", ")]),
    },
    nodeIds: [...biggest],
    edgeIds: g.edges
      .filter((e) => (!types.length || types.includes(e.type)) && biggest.has(e.source) && biggest.has(e.target))
      .map((e) => e.id),
    metrics: {
      ms: performance.now() - t0,
      nodesTouched: seen.size,
      edgesTraversed,
      depth: 0,
      rows: groups.length,
    },
  };
}
