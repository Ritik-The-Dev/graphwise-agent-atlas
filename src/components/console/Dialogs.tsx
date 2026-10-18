import { useEffect, useState, type ReactNode } from "react";
import { Check, Copy, X } from "lucide-react";
import { CypherBlock } from "./CypherCode";
import { scenarios, toCreateScript } from "@/lib/graph/scenarios";
import { cn } from "@/lib/utils";

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-background/70 p-4 backdrop-blur-sm" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
        className={cn(
          "flex max-h-[88vh] w-full flex-col overflow-hidden rounded-xl border border-border-strong bg-popover shadow-2xl animate-in fade-in zoom-in-95 duration-150",
          wide ? "max-w-4xl" : "max-w-xl",
        )}
      >
        <div className="flex items-start justify-between border-b px-5 py-4">
          <div>
            <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
            {subtitle && <p className="mt-0.5 text-[13px] text-muted-foreground">{subtitle}</p>}
          </div>
          <button aria-label="Close" onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="overflow-y-auto p-5 scrollbar-thin">{children}</div>
      </div>
    </div>
  );
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={() => {
        void navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1400);
      }}
      className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      {done ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      {done ? "Copied" : label}
    </button>
  );
}

function Snippet({ code, lang = "bash" }: { code: string; lang?: string }) {
  return (
    <div className="relative">
      <div className="flex items-center justify-between rounded-t-md border border-b-0 bg-muted/40 px-3 py-1.5">
        <span className="font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground">{lang}</span>
        <CopyButton text={code} />
      </div>
      <pre className="overflow-x-auto rounded-b-md border bg-background/60 p-3 font-mono text-[12px] leading-relaxed scrollbar-thin">{code}</pre>
    </div>
  );
}

export type ConnSettings = { host: string; port: string; graph: string; password: string };

export function ConnectDialog({
  open,
  onClose,
  settings,
  onSave,
  scenarioId,
}: {
  open: boolean;
  onClose: () => void;
  settings: ConnSettings;
  onSave: (s: ConnSettings) => void;
  scenarioId: string;
}) {
  const [s, setS] = useState(settings);
  useEffect(() => setS(settings), [settings, open]);
  const sc = scenarios.find((x) => x.id === scenarioId)!;
  const loader = `import { FalkorDB } from "falkordb";

const db = await FalkorDB.connect({
  socket: { host: "${s.host}", port: ${Number(s.port) || 6379} },${s.password ? `\n  password: process.env.FALKORDB_PASSWORD,` : ""}
});
const graph = db.selectGraph("${s.graph}");
await graph.query(createScript); // paste from "Export CREATE"
const res = await graph.query(\`${sc.steps.find((x) => x.kind === "cypher" && "cypher" in x) && (sc.steps[0] as { cypher: string }).cypher.replace(/\n/g, " ")}\`);
console.log(res.data);`;
  const field = (k: keyof ConnSettings, label: string, type = "text") => (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
      <input
        type={type}
        value={s[k]}
        onChange={(e) => setS({ ...s, [k]: e.target.value })}
        className="h-9 w-full rounded-md border bg-background/60 px-3 font-mono text-[13px] outline-none focus:border-border-strong"
      />
    </label>
  );
  return (
    <Modal open={open} onClose={onClose} title="FalkorDB connection" subtitle="Run the same graph & queries on a live FalkorDB instance.">
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3">
          {field("host", "Host")}
          {field("port", "Port")}
          {field("graph", "Graph name")}
          {field("password", "Password", "password")}
        </div>
        <div className="rounded-md border bg-muted/30 p-3 text-[12.5px] leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">Embedded engine is active.</span> Browsers can't open the Redis
          protocol socket FalkorDB speaks, so this console runs an in-browser, FalkorDB-compatible Cypher engine for zero-setup
          judging. Use the loader below to replay any scenario against your instance.
        </div>
        <div className="space-y-2">
          <p className="text-[12px] font-medium">1 · Start FalkorDB</p>
          <Snippet code={`docker pull falkordb/falkordb:latest\ndocker run -p 6379:6379 -p 3000:3000 -it --rm falkordb/falkordb:latest`} />
        </div>
        <div className="space-y-2">
          <p className="text-[12px] font-medium">2 · Load "{sc.name}" and query it</p>
          <Snippet code={loader} lang="ts · npm i falkordb" />
        </div>
        <div className="flex items-center justify-between border-t pt-4">
          <CopyButton text={toCreateScript(sc.graph())} label="Export CREATE script" />
          <button
            onClick={() => {
              onSave(s);
              onClose();
            }}
            className="h-8 rounded-md bg-primary px-3 text-[13px] font-medium text-primary-foreground hover:bg-primary/90"
          >
            Save settings
          </button>
        </div>
      </div>
    </Modal>
  );
}

const ARCH = `┌──────────────────────────── Browser ────────────────────────────┐
│                                                                  │
│  Objective ─▶ Agent Planner ─▶ Tool Router ─┬─▶ Cypher Engine    │
│      ▲                                      ├─▶ shortestPath     │
│      │                                      ├─▶ betweenness      │
│      │                                      └─▶ components       │
│      │                                             │             │
│      │         Evidence Extractor ◀── ToolOutput ◀─┘             │
│      │                │   (rows · node ids · edge ids · metrics) │
│      │                ▼                                          │
│  Audit Trail ◀── Action Executor (quarantine/revoke/notify/SAR)  │
│                       │                                          │
│                       ▼                                          │
│          Force-directed Canvas (path highlighting)               │
└───────────────────────┬──────────────────────────────────────────┘
                        │  same Cypher, same schema
                        ▼
              FalkorDB (docker · falkordb npm client)`;

export function SubmissionKit({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState(scenarios[0].id);
  const sc = scenarios.find((s) => s.id === tab)!;
  const g = sc.graph();
  const labels = [...new Set(g.nodes.map((n) => n.label))];
  const rels = [...new Set(g.edges.map((e) => `(:${g.nodes.find((n) => n.id === e.source)!.label})-[:${e.type}]->(:${g.nodes.find((n) => n.id === e.target)!.label})`))];
  return (
    <Modal open={open} onClose={onClose} wide title="Submission kit" subtitle="Graph Hacks · WeMakeDevs × FalkorDB · Track 01 — Agents That Act on Connected Data">
      <div className="space-y-8 text-[13px] leading-relaxed">
        <section className="grid gap-3 sm:grid-cols-3">
          {[
            ["Multi-hop reasoning", "Variable-length Cypher paths (*1..6) trace laundering, privilege escalation and dependency chains."],
            ["Graph algorithms as tools", "Shortest path, betweenness centrality and connected components are callable by the agent."],
            ["Explainable actions", "Every action cites the query, metrics and evidence that justified it, in an audit trail."],
          ].map(([t, d]) => (
            <div key={t} className="rounded-lg border bg-card p-3">
              <p className="font-medium">{t}</p>
              <p className="mt-1 text-[12.5px] text-muted-foreground">{d}</p>
            </div>
          ))}
        </section>
        <section>
          <h3 className="mb-2 text-[12px] font-medium uppercase tracking-wider text-muted-foreground">Architecture</h3>
          <pre className="overflow-x-auto rounded-md border bg-background/60 p-4 font-mono text-[11.5px] leading-snug text-foreground/85 scrollbar-thin">{ARCH}</pre>
        </section>
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-[12px] font-medium uppercase tracking-wider text-muted-foreground">Schema & queries</h3>
            <div className="flex rounded-md border p-0.5">
              {scenarios.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setTab(s.id)}
                  className={cn("rounded px-2 py-1 text-[12px]", tab === s.id ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground")}
                >
                  {s.short}
                </button>
              ))}
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-[220px_1fr]">
            <div className="space-y-3">
              <div>
                <p className="mb-1 text-[11px] text-muted-foreground">Node labels</p>
                <div className="flex flex-wrap gap-1">
                  {labels.map((l) => (
                    <span key={l} className="rounded border px-1.5 py-0.5 font-mono text-[11px] text-syn-label">:{l}</span>
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-1 text-[11px] text-muted-foreground">Relationships</p>
                <ul className="space-y-0.5 font-mono text-[10.5px] text-muted-foreground">
                  {rels.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </div>
              <p className="text-[11px] text-muted-foreground">
                {g.nodes.length} nodes · {g.edges.length} relationships
              </p>
            </div>
            <div className="space-y-2">
              {sc.steps.filter((s) => s.kind === "cypher").map((s) => (
                <div key={s.title}>
                  <p className="mb-1 text-[12px] text-muted-foreground">{s.title}</p>
                  <CypherBlock code={(s as { cypher: string }).cypher} />
                </div>
              ))}
              <CopyButton text={toCreateScript(g)} label="Copy FalkorDB CREATE script" />
            </div>
          </div>
        </section>
        <section className="grid gap-4 sm:grid-cols-2">
          <div>
            <h3 className="mb-2 text-[12px] font-medium uppercase tracking-wider text-muted-foreground">Demo script (2 min)</h3>
            <ol className="list-decimal space-y-1 pl-4 text-muted-foreground">
              <li>Pick a scenario, press <span className="text-foreground">Run agent</span>.</li>
              <li>Watch each hop light up the path on the canvas.</li>
              <li>Open a step to see rows, depth and latency.</li>
              <li>Review the audit trail in <span className="text-foreground">Actions</span>.</li>
              <li>Edit any query in <span className="text-foreground">Cypher</span> and re-run (⌘↵).</li>
            </ol>
          </div>
          <div>
            <h3 className="mb-2 text-[12px] font-medium uppercase tracking-wider text-muted-foreground">Submission</h3>
            <dl className="space-y-1 text-muted-foreground">
              <div className="flex justify-between gap-4"><dt>Hackathon</dt><dd className="text-foreground">Graph Hacks</dd></div>
              <div className="flex justify-between gap-4"><dt>Organisers</dt><dd className="text-foreground">WeMakeDevs × FalkorDB</dd></div>
              <div className="flex justify-between gap-4"><dt>Track</dt><dd className="text-foreground">01 · Agents on Connected Data</dd></div>
              <div className="flex justify-between gap-4"><dt>Graph DB</dt><dd className="text-foreground">FalkorDB (OpenCypher)</dd></div>
              <div className="flex justify-between gap-4"><dt>Stack</dt><dd className="text-foreground">React 19 · TanStack Start · d3-force</dd></div>
            </dl>
          </div>
        </section>
      </div>
    </Modal>
  );
}
