/**
 * Embedded, FalkorDB-compatible Cypher subset engine.
 * Supports: MATCH with multiple comma-separated path patterns, named paths (p = ...),
 * labels, inline property maps, typed / multi-typed / untyped relationships,
 * direction (->, <-, -), variable-length hops (*, *n, *a..b), WHERE (AND/OR/NOT,
 * =, <>, <, >, <=, >=, CONTAINS, STARTS WITH, IN, IS [NOT] NULL), RETURN [DISTINCT]
 * with AS aliases and count/collect/sum/avg/min/max, ORDER BY, LIMIT.
 */
import type { GEdge, GNode, Graph, ToolOutput } from "./types";

export type PathVal = { __path: true; nodes: GNode[]; edges: GEdge[] };

type NodePat = { v?: string; labels: string[]; props: Record<string, unknown> };
type RelPat = {
  v?: string;
  types: string[];
  dir: "out" | "in" | "both";
  min: number;
  max: number;
  varLen: boolean;
  props: Record<string, unknown>;
};
type Pattern = { pathVar?: string; nodes: NodePat[]; rels: RelPat[] };
type Binding = Record<string, unknown>;
type Row = { b: Binding; pn: Set<string>; pe: Set<string> };

const NOLIT = Symbol("nolit");

export const isNode = (v: unknown): v is GNode =>
  !!v && typeof v === "object" && "label" in v && "props" in v && !("source" in v);
export const isEdge = (v: unknown): v is GEdge =>
  !!v && typeof v === "object" && "source" in v && "type" in v;
export const isPath = (v: unknown): v is PathVal =>
  !!v && typeof v === "object" && "__path" in v;

function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let q: string | null = null;
  let cur = "";
  for (const ch of s) {
    if (q) {
      cur += ch;
      if (ch === q) q = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      q = ch;
      cur += ch;
      continue;
    }
    if ("([{".includes(ch)) depth++;
    if (")]}".includes(ch)) depth--;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Split on a keyword (AND/OR) at top level, outside quotes and parentheses. */
function splitKeyword(s: string, kw: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let q: string | null = null;
  let start = 0;
  const re = new RegExp(`^\\s${kw}\\s`, "i");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === q) q = null;
      continue;
    }
    if (ch === "'" || ch === '"') q = ch;
    else if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    else if (depth === 0 && re.test(s.slice(i, i + kw.length + 2))) {
      out.push(s.slice(start, i));
      i += kw.length + 1;
      start = i;
    }
  }
  out.push(s.slice(start));
  return out.map((x) => x.trim());
}

function parseLiteral(raw: string): unknown {
  const s = raw.trim();
  if ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"')))
    return s.slice(1, -1);
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if (/^true$/i.test(s)) return true;
  if (/^false$/i.test(s)) return false;
  if (/^null$/i.test(s)) return null;
  if (s.startsWith("[") && s.endsWith("]"))
    return splitTop(s.slice(1, -1)).map((x) => {
      const v = parseLiteral(x);
      if (v === NOLIT) throw new Error(`Unsupported list element: ${x}`);
      return v;
    });
  return NOLIT;
}

function parseProps(s?: string): Record<string, unknown> {
  if (!s) return {};
  const out: Record<string, unknown> = {};
  for (const part of splitTop(s.trim().slice(1, -1))) {
    const idx = part.indexOf(":");
    if (idx < 0) throw new Error(`Invalid property map entry: ${part}`);
    const v = parseLiteral(part.slice(idx + 1));
    if (v === NOLIT) throw new Error(`Property values must be literals: ${part}`);
    out[part.slice(0, idx).trim()] = v;
  }
  return out;
}

function parseNode(inner: string): NodePat {
  const m = /^\s*(\w+)?\s*((?::\s*\w+\s*)*)\s*(\{[\s\S]*\})?\s*$/.exec(inner);
  if (!m) throw new Error(`Invalid node pattern: (${inner})`);
  return {
    v: m[1],
    labels: (m[2] ?? "").split(":").map((x) => x.trim()).filter(Boolean),
    props: parseProps(m[3]),
  };
}

function parseRel(inner: string, dir: RelPat["dir"]): RelPat {
  const m =
    /^\s*(\w+)?\s*(?::\s*([\w|:\s]+?))?\s*(\*\s*(\d*)\s*(\.\.)?\s*(\d*))?\s*(\{[\s\S]*\})?\s*$/.exec(
      inner,
    );
  if (!m) throw new Error(`Invalid relationship pattern: [${inner}]`);
  const types = m[2] ? m[2].split("|").map((t) => t.replace(":", "").trim()).filter(Boolean) : [];
  let min = 1;
  let max = 1;
  const varLen = !!m[3];
  if (varLen) {
    min = m[4] ? Number(m[4]) : 1;
    max = m[5] ? (m[6] ? Number(m[6]) : 8) : m[4] ? Number(m[4]) : 8;
  }
  return { v: m[1], types, dir, min, max, varLen, props: parseProps(m[7]) };
}

function closeIdx(s: string, from: number): number {
  let q: string | null = null;
  for (let i = from + 1; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === q) q = null;
      continue;
    }
    if (ch === "'" || ch === '"') q = ch;
    else if (ch === ")") return i;
  }
  throw new Error("Unclosed node pattern — missing ')'");
}

function parsePattern(src: string): Pattern {
  let s = src.trim();
  let pathVar: string | undefined;
  const pm = /^(\w+)\s*=\s*/.exec(s);
  if (pm) {
    pathVar = pm[1];
    s = s.slice(pm[0].length);
  }
  const nodes: NodePat[] = [];
  const rels: RelPat[] = [];
  let i = 0;
  const readNode = () => {
    while (s[i] === " ") i++;
    if (s[i] !== "(") throw new Error(`Expected '(' near: ${s.slice(i, i + 24) || "end of pattern"}`);
    const end = closeIdx(s, i);
    nodes.push(parseNode(s.slice(i + 1, end)));
    i = end + 1;
  };
  readNode();
  while (s.slice(i).trim()) {
    const rest = s.slice(i);
    const m = /^\s*(<)?-\s*(?:\[([^\]]*)\])?\s*-(>)?\s*/.exec(rest);
    if (!m) throw new Error(`Invalid relationship near: ${rest.slice(0, 24)}`);
    if (m[1] && m[3]) throw new Error("Relationship cannot point both ways");
    rels.push(parseRel(m[2] ?? "", m[1] ? "in" : m[3] ? "out" : "both"));
    i += m[0].length;
    readNode();
  }
  return { pathVar, nodes, rels };
}

const norm = (v: unknown): unknown => (isNode(v) || isEdge(v) ? v.id : v);
const keyOf = (v: unknown): string => {
  if (isNode(v) || isEdge(v)) return `#${v.id}`;
  if (isPath(v)) return `p:${v.edges.map((e) => e.id).join(",")}`;
  if (Array.isArray(v)) return `[${v.map(keyOf).join(",")}]`;
  return JSON.stringify(v);
};

function compare(a: unknown, b: unknown): number {
  const x = norm(a);
  const y = norm(b);
  if (x === y) return 0;
  if (x === null || x === undefined) return 1;
  if (y === null || y === undefined) return -1;
  return (x as number) < (y as number) ? -1 : 1;
}

function evalExpr(raw: string, b: Binding): unknown {
  const e = raw.trim();
  const lit = parseLiteral(e);
  if (lit !== NOLIT) return lit;
  let m = /^(length|size)\((\w+)\)$/i.exec(e);
  if (m) {
    const v = b[m[2]];
    if (isPath(v)) return v.edges.length;
    if (Array.isArray(v)) return v.length;
    if (typeof v === "string") return v.length;
    return null;
  }
  m = /^type\((\w+)\)$/i.exec(e);
  if (m) {
    const v = b[m[1]];
    return isEdge(v) ? v.type : Array.isArray(v) ? v.map((x) => (x as GEdge).type) : null;
  }
  m = /^labels\((\w+)\)$/i.exec(e);
  if (m) {
    const v = b[m[1]];
    return isNode(v) ? [v.label] : null;
  }
  m = /^id\((\w+)\)$/i.exec(e);
  if (m) return norm(b[m[1]]);
  m = /^nodes\((\w+)\)$/i.exec(e);
  if (m) {
    const v = b[m[1]];
    return isPath(v) ? v.nodes : null;
  }
  m = /^(\w+)\.(\w+)$/.exec(e);
  if (m) {
    if (!(m[1] in b)) throw new Error(`Variable \`${m[1]}\` not defined`);
    const v = b[m[1]];
    if (isNode(v) || isEdge(v)) return v.props[m[2]] ?? (m[2] === "id" ? v.id : null);
    return null;
  }
  m = /^(\w+)$/.exec(e);
  if (m) {
    if (!(m[1] in b)) throw new Error(`Variable \`${m[1]}\` not defined`);
    return b[m[1]];
  }
  throw new Error(`Unsupported expression: ${e}`);
}

function evalCond(raw: string, b: Binding): boolean {
  let c = raw.trim();
  if (/^NOT\s+/i.test(c)) return !evalCond(c.replace(/^NOT\s+/i, ""), b);
  if (c.startsWith("(") && c.endsWith(")")) return evalWhere(c.slice(1, -1), b);
  let m = /^(.+?)\s+IS\s+(NOT\s+)?NULL$/i.exec(c);
  if (m) {
    const v = evalExpr(m[1], b);
    const isNull = v === null || v === undefined;
    return m[2] ? !isNull : isNull;
  }
  m = /^(.+?)\s+(CONTAINS|STARTS WITH|ENDS WITH|IN)\s+(.+)$/i.exec(c);
  if (m) {
    const l = evalExpr(m[1], b);
    const r = evalExpr(m[3], b);
    const op = m[2].toUpperCase();
    if (op === "IN") return Array.isArray(r) && r.map(norm).includes(norm(l));
    if (typeof l !== "string" || typeof r !== "string") return false;
    if (op === "CONTAINS") return l.includes(r);
    if (op === "STARTS WITH") return l.startsWith(r);
    return l.endsWith(r);
  }
  m = /^(.+?)\s*(<>|!=|>=|<=|=|>|<)\s*(.+)$/.exec(c);
  if (m) {
    const l = evalExpr(m[1], b);
    const r = evalExpr(m[3], b);
    const k = compare(l, r);
    switch (m[2]) {
      case "=":
        return norm(l) === norm(r);
      case "<>":
      case "!=":
        return norm(l) !== norm(r);
      case ">":
        return k > 0;
      case "<":
        return k < 0;
      case ">=":
        return k >= 0;
      case "<=":
        return k <= 0;
    }
  }
  c = c.trim();
  return Boolean(evalExpr(c, b));
}

function evalWhere(expr: string, b: Binding): boolean {
  return splitKeyword(expr, "OR").some((o) => splitKeyword(o, "AND").every((a) => evalCond(a, b)));
}

export type CypherResult = ToolOutput;

export function runCypher(graph: Graph, query: string): CypherResult {
  const t0 = performance.now();
  const src = query
    .replace(/\/\/[^\n]*/g, "")
    .trim()
    .replace(/;\s*$/, "")
    .replace(/\s+/g, " ");
  const m =
    /^MATCH\s+(.+?)(?:\s+WHERE\s+(.+?))?\s+RETURN\s+(.+?)(?:\s+ORDER\s+BY\s+(.+?))?(?:\s+LIMIT\s+(\d+))?$/i.exec(
      src,
    );
  if (!m)
    throw new Error("Expected: MATCH <pattern> [WHERE ...] RETURN ... [ORDER BY ...] [LIMIT n]");

  const patterns = splitTop(m[1]).map(parsePattern);
  const out = new Map<string, GEdge[]>();
  const inn = new Map<string, GEdge[]>();
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  for (const e of graph.edges) {
    (out.get(e.source) ?? out.set(e.source, []).get(e.source)!).push(e);
    (inn.get(e.target) ?? inn.set(e.target, []).get(e.target)!).push(e);
  }
  const touched = new Set<string>();
  let edgesTraversed = 0;
  let depth = 0;

  const nodeOk = (n: GNode, np: NodePat, b: Binding) => {
    touched.add(n.id);
    if (np.v && b[np.v] && (b[np.v] as GNode).id !== n.id) return false;
    if (!np.labels.every((l) => l === n.label)) return false;
    return Object.entries(np.props).every(([k, v]) => n.props[k] === v);
  };
  const relOk = (e: GEdge, rp: RelPat) =>
    (rp.types.length === 0 || rp.types.includes(e.type)) &&
    Object.entries(rp.props).every(([k, v]) => e.props[k] === v);

  const neighbors = (n: GNode, rp: RelPat): [GEdge, GNode][] => {
    const res: [GEdge, GNode][] = [];
    if (rp.dir !== "in")
      for (const e of out.get(n.id) ?? []) if (relOk(e, rp)) res.push([e, byId.get(e.target)!]);
    if (rp.dir !== "out")
      for (const e of inn.get(n.id) ?? []) if (relOk(e, rp)) res.push([e, byId.get(e.source)!]);
    return res;
  };

  const MAX_ROWS = 20000;
  let rows: Row[] = [{ b: {}, pn: new Set(), pe: new Set() }];
  for (const pat of patterns) {
    const next: Row[] = [];
    for (const row of rows) {
      const first = pat.nodes[0];
      const starts =
        first.v && row.b[first.v] ? [row.b[first.v] as GNode] : graph.nodes;
      const extend = (ri: number, cur: GNode, b: Binding, pN: GNode[], pE: GEdge[]) => {
        if (next.length > MAX_ROWS) return;
        if (ri === pat.rels.length) {
          const nb = pat.pathVar ? { ...b, [pat.pathVar]: { __path: true, nodes: pN, edges: pE } } : b;
          depth = Math.max(depth, pE.length);
          next.push({
            b: nb,
            pn: new Set([...row.pn, ...pN.map((x) => x.id)]),
            pe: new Set([...row.pe, ...pE.map((x) => x.id)]),
          });
          return;
        }
        const rp = pat.rels[ri];
        const np = pat.nodes[ri + 1];
        const walk = (node: GNode, d: number, seg: GEdge[], segN: GNode[], visited: Set<string>) => {
          if (d >= rp.min && d > 0 && nodeOk(node, np, b)) {
            const nb: Binding = { ...b };
            if (np.v) nb[np.v] = node;
            if (rp.v) nb[rp.v] = rp.varLen ? seg.slice() : seg[0];
            extend(ri + 1, node, nb, [...pN, ...segN], [...pE, ...seg]);
          }
          if (d >= rp.max) return;
          for (const [e, other] of neighbors(node, rp)) {
            if (seg.includes(e) || pE.includes(e) || visited.has(other.id)) continue;
            edgesTraversed++;
            walk(other, d + 1, [...seg, e], [...segN, other], new Set(visited).add(other.id));
          }
        };
        walk(cur, 0, [], [], new Set([cur.id]));
      };
      for (const n of starts) {
        if (!nodeOk(n, first, row.b)) continue;
        const b: Binding = { ...row.b };
        if (first.v) b[first.v] = n;
        extend(0, n, b, [n], []);
      }
    }
    rows = next;
  }

  if (m[2]) rows = rows.filter((r) => evalWhere(m[2], r.b));

  // RETURN
  let ret = m[3].trim();
  const distinct = /^DISTINCT\s+/i.test(ret);
  if (distinct) ret = ret.replace(/^DISTINCT\s+/i, "");
  const items = splitTop(ret).map((it) => {
    const am = /^(.+?)\s+AS\s+(\w+)$/i.exec(it);
    const expr = am ? am[1] : it;
    const agg = /^(count|collect|sum|avg|min|max)\((DISTINCT\s+)?(.+)\)$/i.exec(expr);
    return {
      expr,
      alias: am ? am[2] : it,
      agg: agg ? { fn: agg[1].toLowerCase(), distinct: !!agg[2], arg: agg[3] } : null,
    };
  });

  let table: unknown[][];
  if (items.some((i) => i.agg)) {
    const groups = new Map<string, { vals: unknown[]; acc: unknown[][] }>();
    for (const r of rows) {
      const vals = items.map((i) => (i.agg ? null : evalExpr(i.expr, r.b)));
      const key = vals.map(keyOf).join("|");
      const g = groups.get(key) ?? { vals, acc: items.map(() => []) };
      items.forEach((i, idx) => {
        if (i.agg) g.acc[idx].push(i.agg.arg === "*" ? 1 : evalExpr(i.agg.arg, r.b));
      });
      groups.set(key, g);
    }
    table = [...groups.values()].map((g) =>
      items.map((i, idx) => {
        if (!i.agg) return g.vals[idx];
        let arr = g.acc[idx].filter((x) => x !== null && x !== undefined);
        if (i.agg.distinct) {
          const seen = new Set<string>();
          arr = arr.filter((x) => (seen.has(keyOf(x)) ? false : (seen.add(keyOf(x)), true)));
        }
        const nums = arr.map(Number);
        switch (i.agg.fn) {
          case "count":
            return arr.length;
          case "collect":
            return arr;
          case "sum":
            return nums.reduce((a, b) => a + b, 0);
          case "avg":
            return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
          case "min":
            return nums.length ? Math.min(...nums) : null;
          default:
            return nums.length ? Math.max(...nums) : null;
        }
      }),
    );
  } else {
    table = rows.map((r) => items.map((i) => evalExpr(i.expr, r.b)));
  }
  if (distinct) {
    const seen = new Set<string>();
    table = table.filter((row) => {
      const k = row.map(keyOf).join("|");
      return seen.has(k) ? false : (seen.add(k), true);
    });
  }
  if (m[4]) {
    const keys = splitTop(m[4]).map((k) => {
      const km = /^(.+?)(?:\s+(ASC|DESC))?$/i.exec(k)!;
      const idx = items.findIndex((i) => i.alias === km[1].trim() || i.expr === km[1].trim());
      if (idx < 0) throw new Error(`ORDER BY must reference a returned column: ${km[1]}`);
      return { idx, desc: /desc/i.test(km[2] ?? "") };
    });
    table.sort((a, b) => {
      for (const k of keys) {
        const c = compare(a[k.idx], b[k.idx]);
        if (c) return k.desc ? -c : c;
      }
      return 0;
    });
  }
  if (m[5]) table = table.slice(0, Number(m[5]));

  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();
  for (const r of rows) {
    r.pn.forEach((x) => nodeIds.add(x));
    r.pe.forEach((x) => edgeIds.add(x));
  }
  return {
    table: { columns: items.map((i) => i.alias), rows: table },
    nodeIds: [...nodeIds],
    edgeIds: [...edgeIds],
    metrics: {
      ms: performance.now() - t0,
      nodesTouched: touched.size,
      edgesTraversed,
      depth,
      rows: table.length,
    },
  };
}
