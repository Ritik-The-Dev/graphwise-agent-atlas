import { useEffect, useRef } from "react";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
} from "d3-force";
import { Maximize2, Minus, Plus } from "lucide-react";
import { displayName, type GEdge, type GNode, type Graph } from "@/lib/graph/types";

type SN = { id: string; x: number; y: number; vx?: number; vy?: number; fx?: number | null; fy?: number | null };
type SL = { source: SN; target: SN; edge: GEdge };

type Props = {
  graph: Graph;
  layoutKey: string;
  labelIndex: Record<string, number>;
  highlightNodes: Set<string>;
  highlightEdges: Set<string>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
};

export function GraphCanvas(props: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const view = useRef({ x: 0, y: 0, k: 1 });
  const simRef = useRef<{ sim: Simulation<SN, SL>; nodes: SN[]; links: SL[] } | null>(null);

  // Build simulation per scenario
  useEffect(() => {
    const g = propsRef.current.graph;
    const nodes: SN[] = g.nodes.map((n, i) => ({
      id: n.id,
      x: Math.cos(i * 2.4) * 120,
      y: Math.sin(i * 2.4) * 120,
    }));
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const links: SL[] = g.edges.map((e) => ({ source: byId.get(e.source)!, target: byId.get(e.target)!, edge: e }));
    const sim = forceSimulation<SN, SL>(nodes)
      .force("link", forceLink<SN, SL>(links).distance(62).strength(0.55))
      .force("charge", forceManyBody().strength(-260))
      .force("collide", forceCollide(20))
      .force("x", forceX(0).strength(0.04))
      .force("y", forceY(0).strength(0.05))
      .force("center", forceCenter(0, 0))
      .alphaDecay(0.03);
    simRef.current = { sim, nodes, links };
    const el = wrapRef.current;
    if (el) view.current = { x: el.clientWidth / 2, y: el.clientHeight / 2, k: 1 };
    return () => {
      sim.stop();
    };
  }, [props.layoutKey]);

  // Render loop
  useEffect(() => {
    let raf = 0;
    const css = getComputedStyle(document.documentElement);
    const v = (n: string) => css.getPropertyValue(n).trim();
    const colors = {
      palette: [0, 1, 2, 3, 4, 5, 6].map((i) => v(`--graph-${i}`)),
      edge: v("--graph-edge"),
      edgeDim: v("--graph-edge-dim"),
      grid: v("--graph-grid"),
      text: v("--graph-text"),
      hl: v("--graph-hl"),
      fg: v("--foreground"),
      bg: v("--background"),
      quarantined: v("--destructive"),
      revoked: v("--warning"),
      notified: v("--success"),
      flagged: v("--info"),
    };
    const draw = (time: number) => {
      raf = requestAnimationFrame(draw);
      const c = canvasRef.current;
      const s = simRef.current;
      if (!c || !s) return;
      const p = propsRef.current;
      const dpr = window.devicePixelRatio || 1;
      const w = c.clientWidth;
      const h = c.clientHeight;
      if (c.width !== w * dpr || c.height !== h * dpr) {
        c.width = w * dpr;
        c.height = h * dpr;
      }
      const ctx = c.getContext("2d")!;
      const t = view.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      // dot grid
      const gap = 24 * t.k;
      if (gap > 8) {
        ctx.fillStyle = colors.grid;
        for (let x = t.x % gap; x < w; x += gap)
          for (let y = t.y % gap; y < h; y += gap) ctx.fillRect(x, y, 1.2, 1.2);
      }
      ctx.translate(t.x, t.y);
      ctx.scale(t.k, t.k);

      const nodeMap = new Map(p.graph.nodes.map((n) => [n.id, n]));
      const deg = new Map<string, number>();
      for (const l of s.links) {
        deg.set(l.source.id, (deg.get(l.source.id) ?? 0) + 1);
        deg.set(l.target.id, (deg.get(l.target.id) ?? 0) + 1);
      }
      const radius = (id: string) => 5 + Math.min(deg.get(id) ?? 0, 7) * 1.1;
      const hasHl = p.highlightNodes.size > 0;

      for (const l of s.links) {
        const hl = p.highlightEdges.has(l.edge.id);
        const dx = l.target.x - l.source.x;
        const dy = l.target.y - l.source.y;
        const len = Math.hypot(dx, dy) || 1;
        const r2 = radius(l.target.id) + 3;
        const ex = l.target.x - (dx / len) * r2;
        const ey = l.target.y - (dy / len) * r2;
        ctx.strokeStyle = hl ? colors.hl : hasHl ? colors.edgeDim : colors.edge;
        ctx.lineWidth = (hl ? 1.8 : 1) / Math.sqrt(t.k);
        ctx.setLineDash(hl ? [5, 4] : []);
        ctx.lineDashOffset = hl ? -time / 30 : 0;
        ctx.beginPath();
        ctx.moveTo(l.source.x, l.source.y);
        ctx.lineTo(ex, ey);
        ctx.stroke();
        ctx.setLineDash([]);
        // arrow
        const a = Math.atan2(dy, dx);
        ctx.fillStyle = ctx.strokeStyle;
        ctx.beginPath();
        ctx.moveTo(ex, ey);
        ctx.lineTo(ex - 6 * Math.cos(a - 0.4), ey - 6 * Math.sin(a - 0.4));
        ctx.lineTo(ex - 6 * Math.cos(a + 0.4), ey - 6 * Math.sin(a + 0.4));
        ctx.closePath();
        ctx.fill();
        if (hl || t.k > 1.7) {
          ctx.font = `500 ${8}px "Geist Mono", monospace`;
          ctx.fillStyle = hl ? colors.hl : colors.text;
          ctx.globalAlpha = hl ? 0.95 : 0.5;
          ctx.textAlign = "center";
          ctx.fillText(l.edge.type, (l.source.x + l.target.x) / 2, (l.source.y + l.target.y) / 2 - 3);
          ctx.globalAlpha = 1;
        }
      }

      for (const sn of s.nodes) {
        const n = nodeMap.get(sn.id) as GNode | undefined;
        if (!n) continue;
        const r = radius(sn.id);
        const inHl = p.highlightNodes.has(sn.id);
        const dim = hasHl && !inHl;
        ctx.globalAlpha = dim ? 0.22 : 1;
        if (inHl) {
          ctx.beginPath();
          ctx.arc(sn.x, sn.y, r + 5 + Math.sin(time / 300) * 1.2, 0, Math.PI * 2);
          ctx.strokeStyle = colors.hl;
          ctx.globalAlpha = 0.35;
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
        ctx.beginPath();
        ctx.arc(sn.x, sn.y, r, 0, Math.PI * 2);
        ctx.fillStyle = colors.palette[(p.labelIndex[n.label] ?? 0) % colors.palette.length];
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = colors.bg;
        ctx.stroke();
        if (n.status) {
          ctx.beginPath();
          ctx.arc(sn.x, sn.y, r + 3, 0, Math.PI * 2);
          ctx.strokeStyle = colors[n.status];
          ctx.lineWidth = 2;
          ctx.setLineDash([3, 2]);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        if (p.selectedId === sn.id) {
          ctx.beginPath();
          ctx.arc(sn.x, sn.y, r + 6, 0, Math.PI * 2);
          ctx.strokeStyle = colors.fg;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
        if (t.k > 0.55 || inHl) {
          ctx.font = `${inHl ? 600 : 450} 10px Geist, sans-serif`;
          ctx.textAlign = "center";
          ctx.fillStyle = inHl ? colors.fg : colors.text;
          ctx.globalAlpha = dim ? 0.18 : inHl ? 1 : 0.75;
          ctx.fillText(displayName(n), sn.x, sn.y + r + 12);
        }
        ctx.globalAlpha = 1;
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Interaction: pan / drag / select / wheel zoom
  useEffect(() => {
    const c = canvasRef.current!;
    let mode: "none" | "pan" | "drag" = "none";
    let dragNode: SN | null = null;
    let start = { x: 0, y: 0 };
    let moved = false;
    const local = (e: PointerEvent | WheelEvent) => {
      const r = c.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const world = (pt: { x: number; y: number }) => ({
      x: (pt.x - view.current.x) / view.current.k,
      y: (pt.y - view.current.y) / view.current.k,
    });
    const down = (e: PointerEvent) => {
      const pt = local(e);
      start = pt;
      moved = false;
      const w = world(pt);
      const found = simRef.current?.sim.find(w.x, w.y, 16) ?? null;
      c.setPointerCapture(e.pointerId);
      if (found) {
        mode = "drag";
        dragNode = found;
        found.fx = found.x;
        found.fy = found.y;
        simRef.current?.sim.alphaTarget(0.25).restart();
      } else mode = "pan";
    };
    const move = (e: PointerEvent) => {
      const pt = local(e);
      if (mode === "none") {
        const w = world(pt);
        c.style.cursor = simRef.current?.sim.find(w.x, w.y, 16) ? "pointer" : "grab";
        return;
      }
      if (Math.hypot(pt.x - start.x, pt.y - start.y) > 3) moved = true;
      if (mode === "pan") {
        view.current.x += e.movementX;
        view.current.y += e.movementY;
        c.style.cursor = "grabbing";
      } else if (dragNode) {
        const w = world(pt);
        dragNode.fx = w.x;
        dragNode.fy = w.y;
      }
    };
    const up = () => {
      if (mode === "drag" && dragNode) {
        if (!moved) propsRef.current.onSelect(dragNode.id);
        dragNode.fx = null;
        dragNode.fy = null;
        simRef.current?.sim.alphaTarget(0);
      } else if (mode === "pan" && !moved) propsRef.current.onSelect(null);
      mode = "none";
      dragNode = null;
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1);
      zoomAt(local(e), Math.exp(-dy * 0.0018));
    };
    c.addEventListener("pointerdown", down);
    c.addEventListener("pointermove", move);
    c.addEventListener("pointerup", up);
    c.addEventListener("pointercancel", up);
    c.addEventListener("wheel", wheel, { passive: false });
    return () => {
      c.removeEventListener("pointerdown", down);
      c.removeEventListener("pointermove", move);
      c.removeEventListener("pointerup", up);
      c.removeEventListener("pointercancel", up);
      c.removeEventListener("wheel", wheel);
    };
  }, []);

  const zoomAt = (pt: { x: number; y: number }, factor: number) => {
    const t = view.current;
    const next = Math.min(4, Math.max(0.25, t.k * factor));
    const k = next / t.k;
    view.current = { x: pt.x - (pt.x - t.x) * k, y: pt.y - (pt.y - t.y) * k, k: next };
  };
  const center = () => {
    const el = wrapRef.current!;
    return { x: el.clientWidth / 2, y: el.clientHeight / 2 };
  };
  const fit = () => {
    const s = simRef.current;
    const el = wrapRef.current;
    if (!s || !el) return;
    const xs = s.nodes.map((n) => n.x);
    const ys = s.nodes.map((n) => n.y);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const k = Math.min(2, Math.max(0.3, Math.min(el.clientWidth / (x1 - x0 + 160), el.clientHeight / (y1 - y0 + 160))));
    view.current = { k, x: el.clientWidth / 2 - ((x0 + x1) / 2) * k, y: el.clientHeight / 2 - ((y0 + y1) / 2) * k };
  };

  return (
    <div ref={wrapRef} className="absolute inset-0">
      <canvas ref={canvasRef} className="h-full w-full touch-none" style={{ cursor: "grab" }} />
      <div className="absolute bottom-4 left-4 flex overflow-hidden rounded-md border bg-card/90 backdrop-blur">
        {[
          { icon: Plus, label: "Zoom in", fn: () => zoomAt(center(), 1.25) },
          { icon: Minus, label: "Zoom out", fn: () => zoomAt(center(), 0.8) },
          { icon: Maximize2, label: "Fit graph", fn: fit },
        ].map(({ icon: Icon, label, fn }) => (
          <button
            key={label}
            aria-label={label}
            title={label}
            onClick={fn}
            className="grid h-8 w-8 place-items-center border-r text-muted-foreground transition-colors last:border-r-0 hover:bg-accent hover:text-foreground"
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        ))}
      </div>
    </div>
  );
}
