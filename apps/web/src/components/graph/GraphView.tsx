"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Pause, Play, Search, Sparkles, Waypoints } from "lucide-react";
import { ForceGraph } from "./ForceGraph";
import { useGraphData } from "@/lib/graph/useGraphData";
import type { GraphNode } from "@/lib/kx/api";
import {
  detectCommunities,
  hashIndex,
  paletteColor,
} from "@/lib/graph/communities";

type ColorBy = "clusters" | "tags" | "off";

const dateFmt = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});

export function GraphView() {
  const router = useRouter();
  const { data, loading, error } = useGraphData();
  const [showGhost, setShowGhost] = useState(true);
  const [query, setQuery] = useState("");
  const [until, setUntil] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [focusPair, setFocusPair] = useState<{ a: string; b: string } | null>(
    null,
  );
  const [panelOpen, setPanelOpen] = useState(true);
  const [colorBy, setColorBy] = useState<ColorBy>("clusters");

  const [minT, maxT] = useMemo(() => {
    if (data.nodes.length === 0) return [0, 0];
    return [
      Math.min(...data.nodes.map((n) => n.createdAt)),
      Math.max(Date.now(), ...data.nodes.map((n) => n.createdAt)),
    ];
  }, [data.nodes]);

  // Timeline playback: sweep from the first note to now in ~8 seconds.
  const playRef = useRef<number>(0);
  useEffect(() => {
    if (!playing) return;
    const start = performance.now();
    const from = until !== null && until < maxT ? until : minT;
    const span = Math.max(1, maxT - from);
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / 8000);
      setUntil(from + span * t);
      if (t < 1) playRef.current = requestAnimationFrame(step);
      else {
        setUntil(null);
        setPlaying(false);
      }
    };
    playRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(playRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  const titleOf = useMemo(
    () => new Map(data.nodes.map((n) => [n.id, n.title])),
    [data.nodes],
  );
  const linkCount = data.edges.length;

  // Topic clusters come from real links plus ghost (semantic) edges.
  const clusters = useMemo(() => {
    const notes = data.nodes.filter((n) => n.kind === "note");
    const comm = detectCommunities(
      notes.map((n) => n.id),
      [...data.edges, ...data.ghostEdges],
    );
    const groups = new Map<number, GraphNode[]>();
    for (const n of notes) {
      const c = comm.get(n.id) ?? -1;
      if (c >= 0) groups.set(c, [...(groups.get(c) ?? []), n]);
    }
    const legend = [...groups]
      .sort((a, b) => a[0] - b[0])
      .slice(0, 6)
      .map(([c, ns]) => ({
        color: paletteColor(c),
        count: ns.length,
        // Name a cluster after its best-connected note.
        label: [...ns].sort((a, b) => b.degree - a.degree)[0]!.title,
      }));
    return { comm, legend };
  }, [data]);

  const nodeColors = useMemo(() => {
    if (colorBy === "off") return undefined;
    const m = new Map<string, string>();
    for (const n of data.nodes) {
      if (n.kind !== "note") continue;
      if (colorBy === "clusters") {
        const c = clusters.comm.get(n.id) ?? -1;
        if (c >= 0) m.set(n.id, paletteColor(c));
      } else if (n.tags[0]) {
        m.set(n.id, paletteColor(hashIndex(n.tags[0])));
      }
    }
    return m;
  }, [colorBy, data.nodes, clusters]);

  const open = (n: GraphNode) =>
    router.push(
      `/documents/${n.kind === "file" ? (n.parentId ?? n.id) : n.id}`,
    );

  return (
    <div className="relative flex h-full w-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-[hsl(var(--sb-border))] px-4 py-2 text-xs">
        <label className="flex items-center gap-2 rounded-lg border border-[hsl(var(--sb-border))] bg-[hsl(var(--sb-bg-panel))] px-2.5 py-1.5">
          <Search size={13} className="text-[hsl(var(--sb-text-faint))]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find in graph"
            aria-label="Find in graph"
            className="w-36 bg-transparent outline-none placeholder:text-[hsl(var(--sb-text-faint))]"
          />
        </label>
        <div
          role="group"
          aria-label="Colour nodes by"
          className="flex items-center rounded-lg border border-[hsl(var(--sb-border))] p-0.5"
        >
          {(["clusters", "tags", "off"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setColorBy(m)}
              aria-pressed={colorBy === m}
              className={`rounded-md px-2 py-1 capitalize transition-colors ${colorBy === m ? "bg-[hsl(var(--sb-accent))]/20 text-white" : "text-[hsl(var(--sb-text-muted))] hover:text-white"}`}
            >
              {m === "off" ? "Plain" : m}
            </button>
          ))}
        </div>
        <button
          onClick={() => setShowGhost((v) => !v)}
          aria-pressed={showGhost}
          className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 transition-colors ${showGhost ? "border-fuchsia-400/40 bg-fuchsia-400/10 text-fuchsia-200" : "border-[hsl(var(--sb-border))] text-[hsl(var(--sb-text-muted))]"}`}
        >
          <Sparkles size={13} /> Ghost links
        </button>
        <div className="flex min-w-[220px] flex-1 items-center gap-2 sm:max-w-md">
          <button
            onClick={() => setPlaying((p) => !p)}
            disabled={data.nodes.length < 2}
            aria-label={playing ? "Pause timeline" : "Play graph growth"}
            className="rounded-lg border border-[hsl(var(--sb-border))] p-1.5 hover:bg-[hsl(var(--sb-bg-hover))] disabled:opacity-40"
          >
            {playing ? <Pause size={13} /> : <Play size={13} />}
          </button>
          <input
            type="range"
            min={minT}
            max={maxT}
            step={Math.max(1, Math.floor((maxT - minT) / 500))}
            value={until ?? maxT}
            disabled={data.nodes.length < 2 || minT === maxT}
            onChange={(e) => {
              setPlaying(false);
              const v = Number(e.target.value);
              setUntil(v >= maxT ? null : v);
            }}
            aria-label="Graph timeline"
            className="h-1 flex-1 accent-[hsl(var(--sb-accent))]"
          />
          <span className="w-24 text-right tabular-nums text-[hsl(var(--sb-text-muted))]">
            {until === null ? "Now" : dateFmt.format(until)}
          </span>
        </div>
        <span className="ml-auto text-[hsl(var(--sb-text-faint))]">
          {data.nodes.length} nodes · {linkCount} links ·{" "}
          {data.ghostEdges.length} suggested
        </span>
        <button
          onClick={() => setPanelOpen((v) => !v)}
          className="rounded-lg border border-[hsl(var(--sb-border))] px-2.5 py-1.5 hover:bg-[hsl(var(--sb-bg-hover))]"
        >
          {panelOpen ? "Hide" : "Show"} suggestions
        </button>
      </div>

      <div className="relative flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1 bg-[hsl(var(--sb-bg))]">
          {loading ? (
            <div className="flex h-full items-center justify-center text-sm text-[hsl(var(--sb-text-muted))]">
              Loading graph…
            </div>
          ) : error ? (
            <div className="flex h-full items-center justify-center text-sm text-red-300">
              Could not load graph: {error}
            </div>
          ) : data.nodes.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-[hsl(var(--sb-text-muted))]">
              <Waypoints size={28} className="text-[hsl(var(--sb-accent))]" />
              Your graph is empty. Create notes and connect them with [[wiki
              links]].
            </div>
          ) : (
            <ForceGraph
              data={data}
              showGhost={showGhost}
              until={until}
              query={query}
              focusPair={focusPair}
              nodeColors={nodeColors}
              onOpen={open}
            />
          )}
          {colorBy === "clusters" && clusters.legend.length > 0 && (
            <ul
              aria-label="Clusters"
              style={{ top: 12, left: 12 }}
              className="pointer-events-none absolute max-w-[220px] space-y-1 rounded-xl bg-black/50 px-3 py-2 text-[11px] text-white/80 backdrop-blur"
            >
              {clusters.legend.map((c) => (
                <li key={c.color} className="flex items-center gap-2">
                  <i
                    className="inline-block h-2 w-2 shrink-0 rounded-full"
                    style={{ background: c.color }}
                  />
                  <span className="truncate">{c.label}</span>
                  <span className="ml-auto text-white/40">{c.count}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap gap-3 rounded-lg bg-black/50 px-3 py-1.5 text-[11px] text-white/70 backdrop-blur">
            <span className="flex items-center gap-1.5">
              <i className="inline-block h-2 w-2 rounded-full bg-white/70" />{" "}
              note
            </span>
            <span className="flex items-center gap-1.5">
              <i className="inline-block h-2 w-2 bg-amber-400" /> file
            </span>
            <span className="flex items-center gap-1.5">
              <i className="inline-block h-0 w-4 border-t border-dashed border-fuchsia-300" />{" "}
              ghost (similar, unlinked)
            </span>
          </div>
        </div>

        {panelOpen && (
          <aside className="hidden w-72 shrink-0 flex-col border-l border-[hsl(var(--sb-border))] bg-[hsl(var(--sb-bg-panel))] md:flex">
            <div className="border-b border-[hsl(var(--sb-border))] px-4 py-3">
              <h2 className="flex items-center gap-2 text-sm font-medium">
                <Sparkles size={14} className="text-fuchsia-300" /> Suggested
                connections
              </h2>
              <p className="mt-1 text-[11px] leading-snug text-[hsl(var(--sb-text-faint))]">
                Notes about similar things that you haven’t linked yet.
              </p>
            </div>
            <ul className="flex-1 overflow-y-auto custom-scrollbar p-2">
              {data.ghostEdges.length === 0 && (
                <li className="p-3 text-xs text-[hsl(var(--sb-text-faint))]">
                  No suggestions yet. Notes are indexed in the background as you
                  write.
                </li>
              )}
              {data.ghostEdges.map((g) => {
                const active = focusPair?.a === g.a && focusPair?.b === g.b;
                return (
                  <li key={`${g.a}-${g.b}`}>
                    <button
                      onMouseEnter={() => setFocusPair({ a: g.a, b: g.b })}
                      onMouseLeave={() => setFocusPair(null)}
                      onClick={() =>
                        router.push(`/documents/${g.a}?connect=${g.b}`)
                      }
                      className={`w-full rounded-lg px-3 py-2 text-left text-xs transition-colors hover:bg-[hsl(var(--sb-bg-hover))] ${active ? "bg-[hsl(var(--sb-bg-hover))]" : ""}`}
                    >
                      <div className="truncate font-medium">
                        {titleOf.get(g.a) ?? "Untitled"}
                      </div>
                      <div className="truncate text-[hsl(var(--sb-text-muted))]">
                        ↔ {titleOf.get(g.b) ?? "Untitled"}
                      </div>
                      <div className="mt-1 h-1 w-full rounded bg-white/10">
                        <div
                          className="h-1 rounded bg-fuchsia-400/70"
                          style={{
                            width: `${Math.min(100, Math.round(g.score * 100))}%`,
                          }}
                        />
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </aside>
        )}
      </div>
    </div>
  );
}
