import { Fragment, type ReactNode, useRef } from "react";
import { cn } from "@/lib/utils";

const TOKEN =
  /(\/\/[^\n]*)|('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")|\b(MATCH|OPTIONAL|WHERE|RETURN|ORDER BY|ORDER|BY|LIMIT|AS|AND|OR|NOT|DISTINCT|DESC|ASC|CONTAINS|STARTS WITH|ENDS WITH|IN|IS|NULL|CREATE|true|false)\b|\b(count|collect|sum|avg|min|max|length|size|type|labels|id|nodes|shortestPath)(?=\()|(:\s*[A-Za-z_][\w|]*)|(\b\d+(?:\.\d+)?\b|\*\d*(?:\.\.\d*)?)/gi;

export function highlightCypher(src: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of src.matchAll(TOKEN)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push(<Fragment key={i++}>{src.slice(last, idx)}</Fragment>);
    const cls = m[1]
      ? "text-muted-foreground italic"
      : m[2]
        ? "text-syn-str"
        : m[3]
          ? "text-syn-kw"
          : m[4]
            ? "text-syn-fn"
            : m[5]
              ? "text-syn-label"
              : "text-syn-num";
    out.push(
      <span key={i++} className={cls}>
        {m[0]}
      </span>,
    );
    last = idx + m[0].length;
  }
  if (last < src.length) out.push(<Fragment key={i++}>{src.slice(last)}</Fragment>);
  return out;
}

export function CypherBlock({ code, className }: { code: string; className?: string }) {
  return (
    <pre
      className={cn(
        "overflow-x-auto whitespace-pre-wrap break-words rounded-md border bg-background/60 p-3 font-mono text-[12px] leading-relaxed text-foreground/90 scrollbar-thin",
        className,
      )}
    >
      {highlightCypher(code)}
    </pre>
  );
}

export function CypherEditor({
  value,
  onChange,
  onRun,
}: {
  value: string;
  onChange: (v: string) => void;
  onRun: () => void;
}) {
  const preRef = useRef<HTMLPreElement>(null);
  const shared =
    "whitespace-pre-wrap break-words p-3 font-mono text-[12.5px] leading-relaxed tracking-normal";
  return (
    <div className="relative min-h-[132px] rounded-md border bg-background/70 focus-within:border-border-strong">
      <pre ref={preRef} aria-hidden className={cn(shared, "pointer-events-none absolute inset-0 overflow-hidden text-foreground/90")}>
        {highlightCypher(value)}
        {"\n"}
      </pre>
      <textarea
        value={value}
        spellCheck={false}
        aria-label="Cypher query"
        onChange={(e) => onChange(e.target.value)}
        onScroll={(e) => {
          if (preRef.current) preRef.current.scrollTop = e.currentTarget.scrollTop;
        }}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            onRun();
          }
        }}
        className={cn(
          shared,
          "relative block min-h-[132px] w-full resize-y bg-transparent text-transparent caret-foreground outline-none",
        )}
      />
    </div>
  );
}
