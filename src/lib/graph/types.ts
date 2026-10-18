export type NodeStatus = "quarantined" | "revoked" | "notified" | "flagged";

export type GNode = {
  id: string;
  label: string;
  props: Record<string, string | number | boolean>;
  status?: NodeStatus;
};

export type GEdge = {
  id: string;
  source: string;
  target: string;
  type: string;
  props: Record<string, string | number | boolean>;
};

export type Graph = { nodes: GNode[]; edges: GEdge[] };

export type Metrics = {
  ms: number;
  nodesTouched: number;
  edgesTraversed: number;
  depth: number;
  rows: number;
};

export type Table = { columns: string[]; rows: unknown[][] };

/** Unified output of any agent tool (Cypher query or graph algorithm). */
export type ToolOutput = {
  table: Table;
  nodeIds: string[];
  edgeIds: string[];
  metrics: Metrics;
};

export const displayName = (n: GNode) => String(n.props.name ?? n.props.title ?? n.id);
