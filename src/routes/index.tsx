import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  BellRing,
  BookOpen,
  Bot,
  ChevronRight,
  CircleDot,
  Database,
  GitBranch,
  KeyRound,
  Loader2,
  Network,
  Play,
  Route as RouteIcon,
  ShieldOff,
  Square,
  Terminal,
  Ticket,
} from "lucide-react";
import { GraphCanvas } from "@/components/console/GraphCanvas";
import { CypherBlock, CypherEditor } from "@/components/console/CypherCode";
import { ConnectDialog, SubmissionKit, type ConnSettings } from "@/components/console/Dialogs";
import { runCypher, isEdge, isNode, isPath } from "@/lib/graph/cypher";
import { centrality, components, shortestPath } from "@/lib/graph/algorithms";
import { actionMeta, scenarios, type ActionKind, type AgentStep } from "@/lib/graph/scenarios";
import { displayName, type Graph, type Table, type ToolOutput } from "@/lib/graph/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Hopwise — Graph agents that act on connected data" },
      {
        name: "description",
        content:
          "Autonomous graph agent console on FalkorDB-compatible Cypher: multi-hop reasoning, graph algorithms and explainable actions for fraud, cloud security and company knowledge.",
      },
      { property: "og:title", content: "Hopwise — Graph agents that act on connected data" },
      {
        property: "og:description",
        content: "Multi-hop Cypher reasoning, graph algorithms and explainable autonomous actions. Built for Graph Hacks × FalkorDB.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Console,
});

type TraceEntry = { step: AgentStep; status: "running" | "done" | "error"; out?: ToolOutput; evidence?: string };
type AuditEntry = {
  id: number;
  ts: string;
  actor: "agent" | "operator";
  action: ActionKind;
  scenario: string;
  targets: string[];
  rationale: string;
  evidence: string[];
};
type Tab = "agent" | "cypher" | "algo" | "actions";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const EMPTY = { nodes: new Set<string>(), edges: new Set<string>() };

function fmt(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (isNode(v)) return displayName(v);
  if (isEdge(v)) return `[:${v.type}]`;
  if (isPath(v)) return v.nodes.map(displayName).join(" → ");
  if (Array.isArray(v)) return `[${v.map(fmt).join(", ")}]`;
  if (typeof v === "number") return Number.isInteger(v) ? v.toLocaleString() : v.toFixed(4);
  return String(v);
}

const actionIcon: Record<ActionKind, typeof ShieldOff> = {
  quarantine: ShieldOff,
  revoke: KeyRound,
  notify: BellRing,
  ticket: Ticket,
};

function Console() {
  const [scenarioId, setScenarioId] = useState(scenarios[0].id);
  const scenario = scenarios.find((s) => s.id === scenarioId)!;
  const [graph, setGraph] = useState<Graph>(() => scenarios[0].graph());
  const [hl, setHl] = useState(EMPTY);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("agent");
  const [trace, setTrace] = useState<TraceEntry[]>([]);
  const [running, setRunning] = useState(false);
  const [openStep, setOpenStep] = useState<number | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [query, setQuery] = useState(scenarios[0].examples[0]);
  const [qres, setQres] = useState<{ out?: ToolOutput; error?: string } | null>(null);
  const [conn, setConn] = useState<ConnSettings>({ host: "localhost", port: "6379", graph: "hopwise", password: "" });
  const [connOpen, setConnOpen] = useState(false);
  const [kitOpen, setKitOpen] = useState(false);
  const runId = useRef(0);
  const auditSeq = useRef(0);

  const labelIndex = useMemo(() => {
    const idx: Record<string, number> = {};
    for (const n of graph.nodes) if (!(n.label in idx)) idx[n.label] = Object.keys(idx).length;
    return idx;
  }, [graph]);

  const focus = useCallback((out?: ToolOutput) => {
    setHl(out ? { nodes: new Set(out.nodeIds), edges: new Set(out.edgeIds) } : EMPTY);
  }, []);

  const switchScenario = (id: string) => {
    runId.current++;
    const sc = scenarios.find((s) => s.id === id)!;
    setScenarioId(id);
    setGraph(sc.graph());
    setTrace([]);
    setRunning(false);
    setHl(EMPTY);
    setSelected(null);
    setQuery(sc.examples[0]);
    setQres(null);
    setOpenStep(null);
  };

  const applyAction = (g: Graph, ids: string[], action: ActionKind): Graph => ({
    ...g,
    nodes: g.nodes.map((n) => (ids.includes(n.id) ? { ...n, status: actionMeta[action].status } : n)),
  });

  const logAction = (entry: Omit<AuditEntry, "id" | "ts">) =>
    setAudit((a) => [{ ...entry, id: ++auditSeq.current, ts: new Date().toISOString() }, ...a]);

  const runAgent = async () => {
    const id = ++runId.current;
    let g = scenario.graph();
    setGraph(g);
    setTrace([]);
    setRunning(true);
    setTab("agent");
    setSelected(null);
    const outs: ToolOutput[] = [];
    const evidence: string[] = [];
    for (const [i, step] of scenario.steps.entries()) {
      if (runId.current !== id) return;
      setTrace((t) => [...t, { step, status: "running" }]);
      setOpenStep(i);
      await sleep(step.kind === "action" ? 500 : 750);
      if (runId.current !== id) return;
      let out: ToolOutput;
      let ev: string;
      try {
        if (step.kind === "cypher") {
          out = runCypher(g, step.cypher);
          ev = step.explain(out);
        } else if (step.kind === "algo") {
          out = step.run(g);
          ev = step.explain(out);
        } else {
          const t0 = performance.now();
          const ids = step.targets(g, outs);
          g = applyAction(g, ids, step.action);
          setGraph(g);
          const nodes = g.nodes.filter((n) => ids.includes(n.id));
          out = {
            table: { columns: ["target", "label", "status"], rows: nodes.map((n) => [displayName(n), n.label, n.status]) },
            nodeIds: ids,
            edgeIds: [],
            metrics: { ms: performance.now() - t0, nodesTouched: ids.length, edgesTraversed: 0, depth: 0, rows: ids.length },
          };
          ev = `${actionMeta[step.action].verb} ${ids.length} entities. ${step.rationale}`;
          logAction({
            actor: "agent",
            action: step.action,
            scenario: scenario.name,
            targets: nodes.map(displayName),
            rationale: step.rationale,
            evidence: [...evidence],
          });
        }
        outs.push(out);
        evidence.push(`#${i + 1} ${step.title}`);
        setTrace((t) => t.map((x, j) => (j === i ? { ...x, status: "done", out, evidence: ev } : x)));
        focus(out);
      } catch (e) {
        setTrace((t) => t.map((x, j) => (j === i ? { ...x, status: "error", evidence: (e as Error).message } : x)));
        break;
      }
      await sleep(450);
    }
    if (runId.current === id) setRunning(false);
  };

  const stop = () => {
    runId.current++;
    setRunning(false);
    setTrace((t) => t.filter((x) => x.status !== "running"));
  };

  const runQuery = () => {
    try {
      const out = runCypher(graph, query);
      setQres({ out });
      focus(out);
    } catch (e) {
      setQres({ error: (e as Error).message });
      focus();
    }
  };

  const manualAction = (action: ActionKind, id: string) => {
    const n = graph.nodes.find((x) => x.id === id)!;
    setGraph((g) => applyAction(g, [id], action));
    logAction({
      actor: "operator",
      action,
      scenario: scenario.name,
      targets: [displayName(n)],
      rationale: "Manual operator action from node inspector.",
      evidence: [`Inspected ${n.label} ${displayName(n)}`],
    });
  };

  const totals = trace.reduce(
    (a, t) => ({
      ms: a.ms + (t.out?.metrics.ms ?? 0),
      nodes: a.nodes + (t.out?.metrics.nodesTouched ?? 0),
      depth: Math.max(a.depth, t.out?.metrics.depth ?? 0),
    }),
    { ms: 0, nodes: 0, depth: 0 },
  );
  const done = !running && trace.length === scenario.steps.length && trace.every((t) => t.status === "done");

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      {/* Top bar */}
      <header className="flex h-14 shrink-0 items-center gap-4 border-b px-4">
        <div className="flex items-center gap-2.5">
          <svg viewBox="0 0 24 24" className="h-5 w-5 text-foreground" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
            <circle cx="5" cy="6" r="2.2" />
            <circle cx="19" cy="6" r="2.2" />
            <circle cx="12" cy="18" r="2.2" />
            <path d="M7 6h10M6.2 8l4.6 8M17.8 8l-4.6 8" />
          </svg>
          <span className="text-[14px] font-semibold tracking-tight">Hopwise</span>
          <span className="hidden text-[13px] text-muted-foreground md:inline">/ graph agent console</span>
        </div>
        <nav className="ml-2 flex rounded-md border bg-surface p-0.5" aria-label="Scenarios">
          {scenarios.map((s) => (
            <button
              key={s.id}
              onClick={() => switchScenario(s.id)}
              className={cn(
                "rounded px-2.5 py-1 text-[12.5px] transition-colors",
                s.id === scenarioId ? "bg-accent text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {s.short}
            </button>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setConnOpen(true)}
            className="hidden items-center gap-2 rounded-md border px-2.5 py-1 text-[12px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground sm:flex"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-success" />
            Embedded Cypher
            <span className="font-mono text-[11px] opacity-60">
              {conn.host}:{conn.port}/{conn.graph}
            </span>
          </button>
          <button
            onClick={() => setConnOpen(true)}
            className="flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[12px] hover:bg-accent"
          >
            <Database className="h-3.5 w-3.5" /> FalkorDB
          </button>
          <button
            onClick={() => setKitOpen(true)}
            className="flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1 text-[12px] font-medium text-primary-foreground hover:bg-primary/90"
          >
            <BookOpen className="h-3.5 w-3.5" /> Submission kit
          </button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[1fr_460px]">
        {/* Canvas */}
        <section className="relative min-h-[50vh] overflow-hidden border-b lg:border-b-0 lg:border-r">
          <GraphCanvas
            graph={graph}
            layoutKey={scenarioId}
            labelIndex={labelIndex}
            highlightNodes={hl.nodes}
            highlightEdges={hl.edges}
            selectedId={selected}
            onSelect={setSelected}
          />
          <div className="pointer-events-none absolute left-4 top-4 max-w-md">
            <p className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">Scenario</p>
            <h1 className="mt-0.5 text-[17px] font-semibold tracking-tight">{scenario.name}</h1>
            <p className="mt-1 font-mono text-[11px] text-muted-foreground">
              {graph.nodes.length} nodes · {graph.edges.length} rels · {Object.keys(labelIndex).length} labels
            </p>
            <div className="pointer-events-auto mt-3 flex flex-wrap gap-1.5">
              {Object.entries(labelIndex).map(([l, i]) => (
                <span key={l} className="flex items-center gap-1.5 rounded border bg-card/80 px-1.5 py-0.5 text-[11px] text-muted-foreground backdrop-blur">
                  <span className="h-2 w-2 rounded-full" style={{ background: `var(--graph-${i % 7})` }} />
                  {l}
                </span>
              ))}
            </div>
          </div>
          {hl.nodes.size > 0 && (
            <button
              onClick={() => focus()}
              className="absolute right-4 top-4 flex items-center gap-1.5 rounded-md border bg-card/90 px-2 py-1 text-[11.5px] text-muted-foreground backdrop-blur hover:text-foreground"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-signal" /> {hl.nodes.size} nodes · {hl.edges.size} rels highlighted · clear
            </button>
          )}
          <StatusLegend />
          {selected && (
            <Inspector graph={graph} id={selected} onSelect={setSelected} onAction={manualAction} labelIndex={labelIndex} />
          )}
        </section>

        {/* Side panel */}
        <aside className="flex min-h-0 flex-col bg-surface">
          <div className="flex shrink-0 border-b px-2" role="tablist">
            {(
              [
                ["agent", "Agent", Bot],
                ["cypher", "Cypher", Terminal],
                ["algo", "Algorithms", GitBranch],
                ["actions", `Actions${audit.length ? ` · ${audit.length}` : ""}`, Activity],
              ] as const
            ).map(([k, label, Icon]) => (
              <button
                key={k}
                role="tab"
                aria-selected={tab === k}
                onClick={() => setTab(k)}
                className={cn(
                  "relative flex items-center gap-1.5 px-3 py-3 text-[12.5px] transition-colors",
                  tab === k ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
                {tab === k && <span className="absolute inset-x-2 -bottom-px h-px bg-foreground" />}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4 scrollbar-thin">
            {tab === "agent" && (
              <div className="space-y-4">
                <div className="rounded-lg border bg-card p-4">
                  <div className="flex items-center justify-between">
                    <p className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">01 · Objective</p>
                    <span className="font-mono text-[10.5px] text-muted-foreground">{scenario.steps.length} planned steps</span>
                  </div>
                  <p className="mt-2 text-[13.5px] leading-relaxed">{scenario.objective}</p>
                  <div className="mt-4 flex gap-2">
                    {running ? (
                      <button onClick={stop} className="flex h-8 items-center gap-1.5 rounded-md border px-3 text-[12.5px] hover:bg-accent">
                        <Square className="h-3 w-3" /> Stop
                      </button>
                    ) : (
                      <button
                        onClick={runAgent}
                        className="flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[12.5px] font-medium text-primary-foreground hover:bg-primary/90"
                      >
                        <Play className="h-3 w-3" /> {trace.length ? "Re-run agent" : "Run agent"}
                      </button>
                    )}
                    {running && (
                      <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                        <span className="h-1.5 w-1.5 rounded-full bg-signal animate-pulse-dot" /> reasoning over graph…
                      </span>
                    )}
                  </div>
                </div>

                {trace.length === 0 && (
                  <ol className="space-y-1.5">
                    {scenario.steps.map((s, i) => (
                      <li key={i} className="flex items-center gap-2.5 rounded-md border border-dashed px-3 py-2 text-[12.5px] text-muted-foreground">
                        <span className="font-mono text-[10.5px]">{String(i + 1).padStart(2, "0")}</span>
                        <ToolBadge kind={s.kind} />
                        <span className="truncate">{s.title}</span>
                      </li>
                    ))}
                  </ol>
                )}

                <ol className="relative space-y-3">
                  {trace.map((t, i) => (
                    <TraceCard
                      key={i}
                      index={i}
                      entry={t}
                      open={openStep === i}
                      onToggle={() => {
                        setOpenStep(openStep === i ? null : i);
                        focus(t.out);
                      }}
                    />
                  ))}
                </ol>

                {done && (
                  <div className="rounded-lg border border-border-strong bg-card p-4">
                    <p className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">Decision path complete</p>
                    <div className="mt-3 grid grid-cols-3 gap-2">
                      <Metric label="total exec" value={`${totals.ms.toFixed(2)}ms`} />
                      <Metric label="nodes touched" value={totals.nodes} />
                      <Metric label="max depth" value={`${totals.depth} hops`} />
                    </div>
                    <button onClick={() => setTab("actions")} className="mt-3 flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground">
                      View audit trail <ChevronRight className="h-3 w-3" />
                    </button>
                  </div>
                )}
              </div>
            )}

            {tab === "cypher" && (
              <div className="space-y-4">
                <CypherEditor value={query} onChange={setQuery} onRun={runQuery} />
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[11px] text-muted-foreground">⌘ / Ctrl + Enter to run</span>
                  <button
                    onClick={runQuery}
                    className="flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[12.5px] font-medium text-primary-foreground hover:bg-primary/90"
                  >
                    <Play className="h-3 w-3" /> Run query
                  </button>
                </div>
                <div>
                  <p className="mb-1.5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">Examples</p>
                  <div className="space-y-1">
                    {[...scenario.examples, ...scenario.steps.flatMap((s) => (s.kind === "cypher" ? [s.cypher] : []))].map((ex) => (
                      <button
                        key={ex}
                        onClick={() => setQuery(ex)}
                        className="block w-full truncate rounded border px-2 py-1.5 text-left font-mono text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        {ex.replace(/\n/g, " ")}
                      </button>
                    ))}
                  </div>
                </div>
                {qres?.error && (
                  <div className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 font-mono text-[12px] text-destructive">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {qres.error}
                  </div>
                )}
                {qres?.out && <ResultPanel out={qres.out} />}
              </div>
            )}

            {tab === "algo" && <AlgorithmsPanel graph={graph} key={scenarioId} onResult={focus} />}

            {tab === "actions" && <AuditPanel audit={audit} />}
          </div>
        </aside>
      </div>

      <ConnectDialog open={connOpen} onClose={() => setConnOpen(false)} settings={conn} onSave={setConn} scenarioId={scenarioId} />
      <SubmissionKit open={kitOpen} onClose={() => setKitOpen(false)} />
    </div>
  );
}

function ToolBadge({ kind }: { kind: AgentStep["kind"] }) {
  const m = {
    cypher: ["CYPHER", "text-syn-kw border-syn-kw/30"],
    algo: ["ALGO", "text-syn-fn border-syn-fn/30"],
    action: ["ACTION", "text-signal border-signal/30"],
  }[kind];
  return <span className={cn("shrink-0 rounded border px-1 py-px font-mono text-[9.5px] tracking-wider", m[1])}>{m[0]}</span>;
}

function Metric({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-md border bg-background/40 px-2 py-1.5">
      <p className="font-mono text-[12.5px] tabular-nums">{value}</p>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
    </div>
  );
}

function MetricsRow({ out }: { out: ToolOutput }) {
  return (
    <div className="grid grid-cols-4 gap-1.5">
      <Metric label="exec" value={`${out.metrics.ms.toFixed(2)}ms`} />
      <Metric label="depth" value={out.metrics.depth} />
      <Metric label="touched" value={out.metrics.nodesTouched} />
      <Metric label="rows" value={out.metrics.rows} />
    </div>
  );
}

function TraceCard({ index, entry, open, onToggle }: { index: number; entry: TraceEntry; open: boolean; onToggle: () => void }) {
  const { step, status, out, evidence } = entry;
  const phase = step.kind === "action" ? "05 · Action" : step.kind === "cypher" ? "02 · Query" : "03 · Algorithm";
  return (
    <li className="animate-in fade-in slide-in-from-bottom-1 rounded-lg border bg-card duration-300">
      <button onClick={onToggle} className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left">
        <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full border font-mono text-[10px] text-muted-foreground">
          {status === "running" ? <Loader2 className="h-3 w-3 animate-spin" /> : index + 1}
        </span>
        <ToolBadge kind={step.kind} />
        <span className="min-w-0 flex-1 truncate text-[13px]">{step.title}</span>
        {out && <span className="font-mono text-[10.5px] text-muted-foreground">{out.metrics.ms.toFixed(2)}ms</span>}
        <ChevronRight className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", open && "rotate-90")} />
      </button>
      {open && (
        <div className="space-y-3 border-t px-3 py-3">
          <div>
            <p className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{phase}</p>
            {step.kind === "cypher" && <CypherBlock code={step.cypher} />}
            {step.kind === "algo" && <CypherBlock code={`CALL ${step.signature}`} />}
            {step.kind === "action" && (
              <p className="flex items-center gap-2 text-[12.5px]">
                {(() => {
                  const I = actionIcon[step.action];
                  return <I className="h-3.5 w-3.5 text-signal" />;
                })()}
                {actionMeta[step.action].verb} — {step.rationale}
              </p>
            )}
          </div>
          {out && (
            <>
              <div>
                <p className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">03 · Execution metrics</p>
                <MetricsRow out={out} />
              </div>
              <div>
                <p className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">04 · Graph evidence</p>
                <p className="text-[12.5px] leading-relaxed text-foreground/90">{evidence}</p>
                <div className="mt-2">
                  <ResultTable table={out.table} max={6} />
                </div>
              </div>
            </>
          )}
          {status === "error" && <p className="font-mono text-[12px] text-destructive">{evidence}</p>}
        </div>
      )}
    </li>
  );
}

function ResultTable({ table, max = 50 }: { table: Table; max?: number }) {
  if (!table.rows.length) return <p className="rounded-md border px-3 py-2 font-mono text-[11.5px] text-muted-foreground">(no rows)</p>;
  return (
    <div className="overflow-x-auto rounded-md border scrollbar-thin">
      <table className="w-full font-mono text-[11px]">
        <thead>
          <tr className="border-b bg-muted/40">
            {table.columns.map((c) => (
              <th key={c} className="whitespace-nowrap px-2 py-1.5 text-left font-medium text-muted-foreground">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.slice(0, max).map((r, i) => (
            <tr key={i} className="border-b last:border-0 hover:bg-accent/40">
              {r.map((c, j) => (
                <td key={j} className={cn("max-w-[220px] truncate px-2 py-1.5", typeof c === "number" ? "text-syn-num" : typeof c === "boolean" ? "text-syn-kw" : "")}>
                  {fmt(c)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {table.rows.length > max && <p className="border-t px-2 py-1 text-[10.5px] text-muted-foreground">+{table.rows.length - max} more rows</p>}
    </div>
  );
}

function ResultPanel({ out }: { out: ToolOutput }) {
  const [view, setView] = useState<"table" | "graph">("table");
  return (
    <div className="space-y-3">
      <MetricsRow out={out} />
      <div className="flex rounded-md border p-0.5">
        {(["table", "graph"] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={cn("flex-1 rounded px-2 py-1 text-[12px] capitalize", view === v ? "bg-accent text-foreground" : "text-muted-foreground")}
          >
            {v}
          </button>
        ))}
      </div>
      {view === "table" ? (
        <ResultTable table={out.table} />
      ) : (
        <div className="rounded-md border bg-card p-3 text-[12.5px] text-muted-foreground">
          <p className="flex items-center gap-2 text-foreground">
            <Network className="h-3.5 w-3.5" /> Subgraph projected on canvas
          </p>
          <p className="mt-1">
            {out.nodeIds.length} matched nodes and {out.edgeIds.length} relationships are highlighted with animated paths. Everything else is dimmed.
          </p>
        </div>
      )}
    </div>
  );
}

function AlgorithmsPanel({ graph, onResult }: { graph: Graph; onResult: (o?: ToolOutput) => void }) {
  const sorted = [...graph.nodes].sort((a, b) => displayName(a).localeCompare(displayName(b)));
  const [from, setFrom] = useState(graph.nodes[0].id);
  const [to, setTo] = useState(graph.nodes[graph.nodes.length - 1].id);
  const [top, setTop] = useState(5);
  const types = [...new Set(graph.edges.map((e) => e.type))];
  const [sel, setSel] = useState<string[]>(types.slice(0, 2));
  const [out, setOut] = useState<{ name: string; out: ToolOutput } | null>(null);
  const run = (name: string, o: ToolOutput) => {
    setOut({ name, out: o });
    onResult(o);
  };
  const select = (v: string, set: (s: string) => void, label: string) => (
    <select
      aria-label={label}
      value={v}
      onChange={(e) => set(e.target.value)}
      className="h-8 w-full rounded-md border bg-background/60 px-2 text-[12px] outline-none"
    >
      {sorted.map((n) => (
        <option key={n.id} value={n.id}>
          {displayName(n)} · {n.label}
        </option>
      ))}
    </select>
  );
  const card = (icon: ReactNode, title: string, desc: string, body: ReactNode, onRun: () => void) => (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="flex items-center gap-2 text-[13px] font-medium">
            {icon}
            {title}
          </p>
          <p className="mt-0.5 text-[12px] text-muted-foreground">{desc}</p>
        </div>
        <button onClick={onRun} className="flex h-7 shrink-0 items-center gap-1 rounded-md border px-2 text-[12px] hover:bg-accent">
          <Play className="h-3 w-3" /> Run
        </button>
      </div>
      <div className="mt-3">{body}</div>
    </div>
  );
  return (
    <div className="space-y-3">
      {card(
        <RouteIcon className="h-3.5 w-3.5" />,
        "Shortest path",
        "BFS over undirected relationships.",
        <div className="grid grid-cols-2 gap-2">
          {select(from, setFrom, "From node")}
          {select(to, setTo, "To node")}
        </div>,
        () => run("shortestPath", shortestPath(graph, from, to)),
      )}
      {card(
        <CircleDot className="h-3.5 w-3.5" />,
        "Betweenness centrality",
        "Brandes algorithm — finds bridges & chokepoints.",
        <label className="flex items-center gap-3 text-[12px] text-muted-foreground">
          Top
          <input type="range" min={3} max={10} value={top} onChange={(e) => setTop(Number(e.target.value))} className="flex-1 accent-foreground" />
          <span className="font-mono text-foreground">{top}</span>
        </label>,
        () => run("centrality", centrality(graph, top)),
      )}
      {card(
        <Network className="h-3.5 w-3.5" />,
        "Connected components",
        "Weakly connected clusters over selected relationship types.",
        <div className="flex flex-wrap gap-1">
          {types.map((t) => (
            <button
              key={t}
              onClick={() => setSel((s) => (s.includes(t) ? s.filter((x) => x !== t) : [...s, t]))}
              className={cn(
                "rounded border px-1.5 py-0.5 font-mono text-[10.5px]",
                sel.includes(t) ? "border-border-strong bg-accent text-foreground" : "text-muted-foreground",
              )}
            >
              {t}
            </button>
          ))}
        </div>,
        () => run("components", components(graph, sel)),
      )}
      {out && (
        <div className="space-y-2 pt-1">
          <p className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">Result · {out.name}</p>
          <ResultPanel out={out.out} />
        </div>
      )}
    </div>
  );
}

function AuditPanel({ audit }: { audit: AuditEntry[] }) {
  if (!audit.length)
    return (
      <div className="rounded-lg border border-dashed p-6 text-center text-[13px] text-muted-foreground">
        No actions yet. Run the agent, or act on a node from the inspector.
      </div>
    );
  return (
    <ol className="space-y-2">
      {audit.map((a) => {
        const I = actionIcon[a.action];
        return (
          <li key={a.id} className="rounded-lg border bg-card p-3 animate-in fade-in duration-300">
            <div className="flex items-center gap-2">
              <I className="h-3.5 w-3.5 text-signal" />
              <span className="text-[13px] font-medium">{actionMeta[a.action].verb}</span>
              <span className="rounded border px-1 font-mono text-[10px] text-muted-foreground">{a.actor}</span>
              <span className="ml-auto font-mono text-[10.5px] text-muted-foreground">{a.ts.slice(11, 19)}Z</span>
            </div>
            <p className="mt-1 text-[11.5px] text-muted-foreground">{a.scenario}</p>
            <div className="mt-2 flex flex-wrap gap-1">
              {a.targets.map((t) => (
                <span key={t} className="rounded bg-accent px-1.5 py-0.5 font-mono text-[10.5px]">
                  {t}
                </span>
              ))}
            </div>
            <p className="mt-2 text-[12px] leading-relaxed">{a.rationale}</p>
            {a.evidence.length > 0 && (
              <ul className="mt-2 space-y-0.5 border-l pl-2.5 font-mono text-[10.5px] text-muted-foreground">
                {a.evidence.map((e) => (
                  <li key={e}>↳ {e}</li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function StatusLegend() {
  return (
    <div className="pointer-events-none absolute bottom-4 left-32 hidden gap-3 font-mono text-[10.5px] text-muted-foreground md:flex">
      {[
        ["quarantined", "bg-destructive"],
        ["revoked", "bg-warning"],
        ["notified", "bg-success"],
        ["ticket", "bg-info"],
      ].map(([l, c]) => (
        <span key={l} className="flex items-center gap-1.5">
          <span className={cn("h-1.5 w-1.5 rounded-full", c)} />
          {l}
        </span>
      ))}
    </div>
  );
}

function Inspector({
  graph,
  id,
  onSelect,
  onAction,
  labelIndex,
}: {
  graph: Graph;
  id: string;
  onSelect: (id: string | null) => void;
  onAction: (a: ActionKind, id: string) => void;
  labelIndex: Record<string, number>;
}) {
  const n = graph.nodes.find((x) => x.id === id);
  if (!n) return null;
  const rels = graph.edges.filter((e) => e.source === id || e.target === id);
  return (
    <div className="absolute bottom-4 right-4 w-[300px] rounded-lg border border-border-strong bg-popover/95 shadow-xl backdrop-blur animate-in fade-in slide-in-from-bottom-2 duration-200">
      <div className="flex items-center gap-2 border-b px-3 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: `var(--graph-${(labelIndex[n.label] ?? 0) % 7})` }} />
        <span className="truncate text-[13px] font-medium">{displayName(n)}</span>
        <span className="font-mono text-[10.5px] text-syn-label">:{n.label}</span>
        <button onClick={() => onSelect(null)} className="ml-auto text-[11px] text-muted-foreground hover:text-foreground">
          esc
        </button>
      </div>
      <dl className="max-h-36 space-y-0.5 overflow-y-auto px-3 py-2 font-mono text-[11px] scrollbar-thin">
        {Object.entries({ key: n.id, ...n.props, ...(n.status ? { status: n.status } : {}) }).map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="truncate">{String(v)}</dd>
          </div>
        ))}
      </dl>
      <div className="border-t px-3 py-2">
        <p className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">{rels.length} relationships</p>
        <ul className="max-h-24 space-y-0.5 overflow-y-auto font-mono text-[10.5px] scrollbar-thin">
          {rels.map((e) => {
            const other = graph.nodes.find((x) => x.id === (e.source === id ? e.target : e.source))!;
            return (
              <li key={e.id}>
                <button onClick={() => onSelect(other.id)} className="truncate text-left text-muted-foreground hover:text-foreground">
                  {e.source === id ? `-[:${e.type}]->` : `<-[:${e.type}]-`} {displayName(other)}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="grid grid-cols-4 gap-1 border-t p-2">
        {(Object.keys(actionMeta) as ActionKind[]).map((a) => {
          const I = actionIcon[a];
          return (
            <button
              key={a}
              onClick={() => onAction(a, id)}
              title={a}
              className="flex flex-col items-center gap-0.5 rounded-md py-1.5 text-[10px] capitalize text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <I className="h-3.5 w-3.5" />
              {a}
            </button>
          );
        })}
      </div>
    </div>
  );
}
