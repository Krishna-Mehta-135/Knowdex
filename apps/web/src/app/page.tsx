"use client";
import React, { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import { LogoMark } from "@/components/ui/LogoMark";
import {
  ArrowRight,
  Brain,
  Network,
  Search,
  Command,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  Plus,
  Star,
  Clock,
  FileText,
  Settings,
  Bell,
  MoreHorizontal,
  Code,
  CheckSquare,
  Link2,
  List,
  Hash,
  Type,
  Quote,
  MessageSquareText,
  Table2,
  CloudOff,
} from "lucide-react";

// ─── Physics Graph (Obsidian-style) ─────────────────────────────────────────

const REPULSION = 2800;
const SPRING_K = 0.018;
const REST_LEN = 120;
const GRAVITY = 0.0012;
const DAMPING = 0.82; // <1 but not too low → wiggly overshoot

interface PhysNode {
  id: number;
  r: number;
  color: string;
  label: string;
}
interface PhysEdge {
  a: number;
  b: number;
  strength?: number;
}

const NODE_META: PhysNode[] = [
  { id: 0, r: 11, color: "#6366f1", label: "Machine Learning" },
  { id: 1, r: 7, color: "#8b5cf6", label: "Neural Nets" },
  { id: 2, r: 6, color: "#8b5cf6", label: "Research" },
  { id: 3, r: 7, color: "#8b5cf6", label: "Knowledge Graph" },
  { id: 4, r: 8, color: "#8b5cf6", label: "Deep Learning" },
  { id: 5, r: 4, color: "#71717a", label: "Transformers" },
  { id: 6, r: 4, color: "#71717a", label: "Embeddings" },
  { id: 7, r: 4, color: "#71717a", label: "RAG" },
];
const EDGES: PhysEdge[] = [
  { a: 0, b: 1 },
  { a: 0, b: 2 },
  { a: 0, b: 3 },
  { a: 0, b: 4 },
  { a: 1, b: 5 },
  { a: 1, b: 6 },
  { a: 2, b: 7 },
  { a: 3, b: 4 },
];

function PhysicsGraph() {
  const W = 400;
  const H = 400;

  // Deterministic initialization on server and client
  const initialPositions = NODE_META.map((_, i) => {
    const angle = (i / NODE_META.length) * Math.PI * 2;
    return {
      x: W / 2 + Math.cos(angle) * 120,
      y: H / 2 + Math.sin(angle) * 120,
    };
  });

  const posRef = useRef(initialPositions);
  const velRef = useRef(NODE_META.map(() => ({ vx: 0, vy: 0 })));
  const dragRef = useRef<{ idx: number; ox: number; oy: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const rafRef = useRef<number>(0);

  const [, setTick] = useState(0);

  useEffect(() => {
    const tick = () => {
      const pos = posRef.current;
      const vel = velRef.current;
      const N = pos.length;
      const dragIdx = dragRef.current?.idx ?? -1;

      // Ambient motion — a very subtle chaotic force to keep it alive
      const time = Date.now() / 1500;

      for (let i = 0; i < N; i++) {
        // Add ambient drift
        if (i !== dragIdx) {
          vel[i]!.vx += Math.sin(time + i) * 0.006;
          vel[i]!.vy += Math.cos(time * 0.8 + i) * 0.006;
        }

        for (let j = i + 1; j < N; j++) {
          const dx = pos[j]!.x - pos[i]!.x;
          const dy = pos[j]!.y - pos[i]!.y;
          const d2 = dx * dx + dy * dy || 0.01;
          const d = Math.sqrt(d2);
          const f = REPULSION / d2;
          const fx = (f * dx) / d;
          const fy = (f * dy) / d;
          if (i !== dragIdx) {
            vel[i]!.vx -= fx;
            vel[i]!.vy -= fy;
          }
          if (j !== dragIdx) {
            vel[j]!.vx += fx;
            vel[j]!.vy += fy;
          }
        }
      }

      for (const e of EDGES) {
        const dx = pos[e.b]!.x - pos[e.a]!.x;
        const dy = pos[e.b]!.y - pos[e.a]!.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const f = SPRING_K * (d - REST_LEN);
        const fx = (f * dx) / d;
        const fy = (f * dy) / d;
        if (e.a !== dragIdx) {
          vel[e.a]!.vx += fx;
          vel[e.a]!.vy += fy;
        }
        if (e.b !== dragIdx) {
          vel[e.b]!.vx -= fx;
          vel[e.b]!.vy -= fy;
        }
      }

      for (let i = 0; i < N; i++) {
        if (i === dragIdx) continue;
        vel[i]!.vx += (W / 2 - pos[i]!.x) * GRAVITY;
        vel[i]!.vy += (H / 2 - pos[i]!.y) * GRAVITY;
        vel[i]!.vx *= DAMPING;
        vel[i]!.vy *= DAMPING;
        pos[i]!.x = Math.max(12, Math.min(W - 12, pos[i]!.x + vel[i]!.vx));
        pos[i]!.y = Math.max(12, Math.min(H - 12, pos[i]!.y + vel[i]!.vy));
      }

      setTick((t) => t + 1);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [H, W]);

  const toSVG = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      if (!svgRef.current) return { x: 0, y: 0 };
      const r = svgRef.current.getBoundingClientRect();
      let clientX = 0;
      let clientY = 0;

      if ("touches" in e) {
        clientX = e.touches[0]!.clientX;
        clientY = e.touches[0]!.clientY;
      } else {
        clientX = (e as React.MouseEvent).clientX;
        clientY = (e as React.MouseEvent).clientY;
      }

      return {
        x: ((clientX - r.left) / r.width) * W,
        y: ((clientY - r.top) / r.height) * H,
      };
    },
    [W, H],
  );

  const onDown = useCallback(
    (e: React.MouseEvent | React.TouchEvent, idx: number) => {
      if (e.cancelable) e.preventDefault();
      const { x, y } = toSVG(e);
      dragRef.current = {
        idx,
        ox: x - posRef.current[idx]!.x,
        oy: y - posRef.current[idx]!.y,
      };
      velRef.current[idx]!.vx = 0;
      velRef.current[idx]!.vy = 0;
    },
    [toSVG],
  );

  const onMove = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      if (!dragRef.current) return;
      const { x, y } = toSVG(e);
      const { idx, ox, oy } = dragRef.current;
      posRef.current[idx] = {
        x: Math.max(12, Math.min(W - 12, x - ox)),
        y: Math.max(12, Math.min(H - 12, y - oy)),
      };
    },
    [toSVG],
  );

  const onUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  const pos = posRef.current;

  return (
    <div className="relative w-full">
      <div className="aspect-square rounded-2xl bg-[hsl(var(--sb-bg))] border border-[hsl(var(--sb-border))] sb-glow relative select-none overflow-hidden touch-none">
        <style
          dangerouslySetInnerHTML={{
            __html: `
              @keyframes gPulse { 0%,100%{opacity:.75} 50%{opacity:1} }
              .gp { animation: gPulse 2.8s ease-in-out infinite }
            `,
          }}
        />
        <svg
          ref={svgRef}
          width="100%"
          height="100%"
          viewBox={`0 0 ${W} ${H}`}
          onMouseMove={onMove}
          onMouseUp={onUp}
          onMouseLeave={onUp}
          onTouchMove={onMove}
          onTouchEnd={onUp}
          style={{ cursor: dragRef.current ? "grabbing" : "default" }}
        >
          {EDGES.map((e) => (
            <line
              key={`${e.a}-${e.b}`}
              x1={pos[e.a]!.x}
              y1={pos[e.a]!.y}
              x2={pos[e.b]!.x}
              y2={pos[e.b]!.y}
              stroke="#818cf8"
              strokeWidth="1.2"
              strokeOpacity={e.a === 0 ? 0.6 : 0.35}
            />
          ))}
          {NODE_META.map((n) => {
            const p = pos[n.id]!;
            const isDrag = dragRef.current?.idx === n.id;
            return (
              <g
                key={n.id}
                onMouseDown={(e) => onDown(e, n.id)}
                onTouchStart={(e) => onDown(e, n.id)}
                style={{ cursor: isDrag ? "grabbing" : "grab" }}
              >
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={n.r + 5}
                  fill="none"
                  stroke={n.color}
                  strokeWidth="1"
                  strokeOpacity={isDrag ? 0.5 : 0.15}
                  className={isDrag ? "" : "gp"}
                />
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={n.r}
                  fill={n.color}
                  style={{
                    filter: isDrag
                      ? `drop-shadow(0 0 8px ${n.color})`
                      : `drop-shadow(0 0 3px ${n.color}88)`,
                  }}
                />
                {n.label && (
                  <text
                    x={p.x}
                    y={p.y + n.r + 11}
                    textAnchor="middle"
                    fill={n.id === 0 ? "#e4e4e7" : "#71717a"}
                    fontSize={n.id === 0 ? 10 : 8.5}
                    fontWeight={n.id === 0 ? "500" : "400"}
                    style={{ pointerEvents: "none", userSelect: "none" }}
                  >
                    {n.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
      <div className="mt-3 text-center min-h-[20px]">
        <span className="text-xs text-zinc-600">
          {dragRef.current
            ? "Dragging — other nodes react to the force"
            : "Drag any node — physics push others away"}
        </span>
      </div>
      <>
        <div className="absolute top-4 left-4 sb-glass px-3 py-1.5 rounded-lg text-xs font-medium text-white sb-float z-10">
          Cluster: Machine Learning
        </div>
        <div
          className="absolute bottom-10 right-4 sb-glass px-3 py-1.5 rounded-lg text-xs font-medium text-white sb-float z-10"
          style={{ animationDelay: "1s" }}
        >
          342 Nodes · 1,204 Links
        </div>
      </>
    </div>
  );
}

// ─── Feature Card Visuals ────────────────────────────────────────────────────

function BiLinksVisual() {
  return (
    <div className="flex flex-col sm:flex-row items-center sm:items-stretch justify-center w-full h-full p-6 sm:p-5 gap-4 sm:gap-3 overflow-hidden">
      <div className="flex-1 w-full sm:w-auto bg-[hsl(240,10%,4.5%)] border border-[hsl(240,10%,11%)] rounded-xl p-3.5 flex flex-col justify-between min-h-[120px] sm:min-h-0 transition-transform hover:scale-[1.02]">
        <div>
          <div className="flex items-center gap-1.5 mb-2 sm:mb-3">
            <div className="w-2.5 h-2.5 rounded-sm bg-indigo-500/30 border border-indigo-500/50 shrink-0" />
            <span className="text-zinc-500 font-mono text-[9px] truncate">
              product-spec-v2.md
            </span>
          </div>
          <div className="text-zinc-400 text-[10px] sm:text-[9.5px] leading-[1.6] sm:leading-[1.7]">
            The graph engine will power the{" "}
            <span className="text-indigo-400 bg-indigo-500/12 rounded px-0.5 border-b border-indigo-400/30 cursor-pointer">
              [[Graph Engine]]
            </span>{" "}
            module.
          </div>
        </div>
        <div className="flex items-center gap-1 mt-2 text-zinc-700 text-[8.5px]">
          <Link2 size={7} />
          <span>1 outgoing link</span>
        </div>
      </div>

      <div className="flex flex-col items-center justify-center gap-2 sm:gap-1.5 shrink-0 sm:w-12 py-1 sm:py-2">
        <div className="flex flex-col sm:flex-row items-center gap-0.5 text-indigo-400">
          <div className="hidden sm:block w-px h-4 sm:h-px sm:w-8 bg-indigo-500/40" />
          <div className="sm:hidden w-px h-6 bg-indigo-500/40" />
          <svg
            width="6"
            height="8"
            viewBox="0 0 6 8"
            className="rotate-90 sm:rotate-0"
          >
            <polygon points="0,0 6,4 0,8" fill="currentColor" />
          </svg>
        </div>
        <div className="text-[7.5px] text-zinc-600 tracking-tighter uppercase font-bold px-1 py-0.5 sm:py-0">
          SYNC
        </div>
        <div className="flex flex-col-reverse sm:flex-row items-center gap-0.5 text-violet-400">
          <svg
            width="6"
            height="8"
            viewBox="0 0 6 8"
            className="rotate-[270deg] sm:rotate-180"
          >
            <polygon points="0,0 6,4 0,8" fill="currentColor" />
          </svg>
          <div className="hidden sm:block w-px h-4 sm:h-px sm:w-8 bg-violet-500/40" />
          <div className="sm:hidden w-px h-6 bg-violet-500/40" />
        </div>
      </div>

      <div className="flex-1 w-full sm:w-auto bg-[hsl(240,10%,4.5%)] border border-[hsl(240,10%,11%)] rounded-xl p-3.5 flex flex-col justify-between min-h-[120px] sm:min-h-0 transition-transform hover:scale-[1.02]">
        <div>
          <div className="flex items-center gap-1.5 mb-2 sm:mb-3">
            <div className="w-2.5 h-2.5 rounded-sm bg-violet-500/30 border border-violet-500/50 shrink-0" />
            <span className="text-zinc-500 font-mono text-[9px] truncate">
              graph-engine.md
            </span>
          </div>
          <div className="text-zinc-400 text-[10px] sm:text-[9.5px] leading-[1.6] sm:leading-[1.7]">
            Force-directed layout using WebGL canvas. Handles 10k+ nodes with
            smooth 60fps…
          </div>
        </div>
        <div className="mt-2.5 border-t border-white/[0.04] pt-2.5">
          <div className="text-[7.5px] text-zinc-600 uppercase tracking-widest mb-1.5">
            Backlinks
          </div>
          <div className="flex items-center gap-1.5 text-[9px] text-violet-400/90">
            <span className="text-zinc-700 text-[10px]">↩</span>
            <span>product-spec-v2</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function GraphViewVisual() {
  const ns = [
    { x: 150, y: 85, r: 10, c: "#6366f1", l: "Machine Learning" },
    { x: 82, y: 43, r: 6, c: "#8b5cf6", l: "Neural Nets" },
    { x: 218, y: 46, r: 6, c: "#8b5cf6", l: "Research" },
    { x: 78, y: 132, r: 5, c: "#8b5cf6", l: "Knowledge" },
    { x: 218, y: 128, r: 7, c: "#8b5cf6", l: "Deep Learning" },
    { x: 38, y: 82, r: 3, c: "#3f3f46", l: "" },
    { x: 258, y: 88, r: 3, c: "#3f3f46", l: "" },
    { x: 150, y: 155, r: 3, c: "#3f3f46", l: "" },
  ];
  const es: [number, number][] = [
    [0, 1],
    [0, 2],
    [0, 3],
    [0, 4],
    [1, 5],
    [2, 6],
    [4, 7],
  ];
  return (
    <div className="flex items-center justify-center w-full h-full">
      <svg width="300" height="176" viewBox="0 0 300 176">
        {es.map(([a, b]) => (
          <line
            key={`${a}-${b}`}
            x1={ns[a]!.x}
            y1={ns[a]!.y}
            x2={ns[b]!.x}
            y2={ns[b]!.y}
            stroke="#818cf8"
            strokeWidth="1.2"
            strokeOpacity={b < 5 ? 0.6 : 0.3}
          />
        ))}
        {ns.map((n, i) => (
          <g key={i}>
            {n.r >= 5 && (
              <circle
                cx={n.x}
                cy={n.y}
                r={n.r + 5}
                fill="none"
                stroke={n.c}
                strokeWidth="0.5"
                strokeOpacity="0.2"
              />
            )}
            <circle
              cx={n.x}
              cy={n.y}
              r={n.r}
              fill={n.c}
              style={{ filter: `drop-shadow(0 0 ${n.r / 1.5}px ${n.c}99)` }}
            />
            {n.l && (
              <text
                x={n.x}
                y={n.y + n.r + 13}
                textAnchor="middle"
                fill="#71717a"
                fontSize="8.5"
              >
                {n.l}
              </text>
            )}
          </g>
        ))}
      </svg>
    </div>
  );
}

function CommandPaletteVisual() {
  return (
    <div className="flex items-center justify-center w-full h-full p-6">
      <div
        className="w-full max-w-[255px] bg-[hsl(240,10%,6%)] border border-[hsl(240,10%,14%)] rounded-xl overflow-hidden"
        style={{
          boxShadow:
            "0 25px 50px -12px rgba(0,0,0,0.8), 0 0 40px -10px rgba(99,102,241,0.15)",
        }}
      >
        <div className="flex items-center px-3 h-11 border-b border-[hsl(240,10%,12%)] gap-2">
          <Search size={13} className="text-zinc-500" />
          <span className="text-sm text-zinc-300 flex-1">
            graph
            <span
              className="inline-block w-0.5 h-4 bg-indigo-400 ml-0.5 animate-pulse"
              style={{ verticalAlign: "middle" }}
            />
          </span>
          <div className="text-[9px] bg-[hsl(240,10%,9%)] border border-[hsl(240,10%,16%)] px-1.5 py-0.5 rounded text-zinc-600 font-mono">
            ESC
          </div>
        </div>
        <div className="p-1.5 space-y-0.5">
          <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg bg-indigo-500/15 border border-indigo-500/20">
            <Network size={13} className="text-indigo-400 shrink-0" />
            <span className="text-[12px] text-indigo-300 font-medium">
              Open Graph View
            </span>
            <span className="ml-auto text-[10px] text-indigo-500/70 font-mono">
              ⌘G
            </span>
          </div>
          <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-zinc-500">
            <FileText size={13} className="shrink-0" />
            <span className="text-[12px]">Graph Engine Design</span>
          </div>
          <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-zinc-500">
            <FileText size={13} className="shrink-0" />
            <span className="text-[12px]">Force-directed Graph</span>
          </div>
        </div>
        <div className="border-t border-[hsl(240,10%,12%)] px-3 py-2 flex gap-4 text-[10px] text-zinc-700">
          <span>
            <span className="font-mono">↑↓</span> navigate
          </span>
          <span>
            <span className="font-mono">↵</span> open
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Embedded App Editor ──────────────────────────────────────────────────────

function AskVisual() {
  return (
    <div className="flex items-center justify-center w-full h-full p-5">
      <div className="w-full max-w-[300px] space-y-2.5">
        <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-indigo-500/20 px-3 py-1.5 text-[11px] text-zinc-200">
          How do we keep edits from conflicting?
        </div>
        <div
          className="rounded-2xl rounded-bl-sm border border-[hsl(240,10%,14%)] bg-[hsl(240,10%,6%)] p-3"
          style={{ boxShadow: "0 0 40px -14px rgba(99,102,241,0.25)" }}
        >
          <p className="text-[11px] leading-relaxed text-zinc-300">
            CRDTs merge concurrent edits without conflicts, even offline
            <span className="mx-0.5 inline-flex h-3.5 min-w-3.5 items-center justify-center rounded bg-indigo-500/25 px-1 text-[9px] font-semibold text-indigo-300">
              1
            </span>
            and WebSockets carry the updates
            <span className="mx-0.5 inline-flex h-3.5 min-w-3.5 items-center justify-center rounded bg-indigo-500/25 px-1 text-[9px] font-semibold text-indigo-300">
              2
            </span>
            .
          </p>
          <div className="mt-2.5 flex flex-wrap gap-1.5 border-t border-[hsl(240,10%,12%)] pt-2">
            {["CRDTs", "WebSockets"].map((t, i) => (
              <span
                key={t}
                className="flex items-center gap-1 rounded-md border border-[hsl(240,10%,14%)] px-1.5 py-0.5 text-[10px] text-zinc-500"
              >
                <b className="text-indigo-400">{i + 1}</b>
                <FileText size={9} /> {t}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function DatabaseVisual() {
  const cols = [
    { name: "To do", tint: "bg-white/10 text-zinc-300", cards: ["Write docs"] },
    {
      name: "In progress",
      tint: "bg-sky-500/20 text-sky-200",
      cards: ["Ship graph", "Kanban view"],
    },
    {
      name: "Done",
      tint: "bg-emerald-500/20 text-emerald-200",
      cards: ["Schema"],
    },
  ];
  return (
    <div className="flex items-center justify-center w-full h-full p-5">
      <div className="flex w-full max-w-[330px] gap-2">
        {cols.map((c) => (
          <div
            key={c.name}
            className="flex-1 rounded-xl border border-[hsl(240,10%,14%)] bg-[hsl(240,10%,6%)] p-2"
          >
            <div className="mb-2 flex items-center gap-1.5">
              <span className={`rounded px-1.5 py-0.5 text-[9px] ${c.tint}`}>
                {c.name}
              </span>
              <span className="text-[9px] text-zinc-600">{c.cards.length}</span>
            </div>
            <div className="space-y-1.5">
              {c.cards.map((card) => (
                <div
                  key={card}
                  className="rounded-lg border border-[hsl(240,10%,12%)] bg-[hsl(240,10%,4%)] px-2 py-1.5 text-[10px] text-zinc-300"
                >
                  {card}
                  <div className="mt-1 text-[9px] text-zinc-600">📅 Oct 9</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function OfflineVisual() {
  return (
    <div className="flex items-center justify-center w-full h-full p-5">
      <div className="w-full max-w-[300px] space-y-2.5">
        <div className="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-[10px] text-amber-100">
          <CloudOff size={12} /> You’re offline. Edits are saved on this device.
        </div>
        <div className="rounded-xl border border-[hsl(240,10%,14%)] bg-[hsl(240,10%,6%)] p-3">
          <div className="h-2 w-2/3 rounded bg-zinc-700" />
          <div className="mt-2 h-1.5 w-full rounded bg-zinc-800" />
          <div className="mt-1.5 h-1.5 w-4/5 rounded bg-zinc-800" />
          <div className="mt-3 text-[9px] text-zinc-600">
            3 changes waiting to sync
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-[10px] text-emerald-200">
          ✓ Back online — all changes synced.
        </div>
      </div>
    </div>
  );
}

function BlockGutter() {
  return (
    <div className="absolute -left-6 top-0.5 opacity-0 group-hover:opacity-100 flex items-center transition-opacity cursor-pointer text-[hsl(var(--sb-text-faint))] hover:text-white select-none">
      <MoreHorizontal size={12} />
    </div>
  );
}

function TagBadge({ label }: { label: string }) {
  return (
    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-[hsl(var(--sb-accent))/0.12] text-[hsl(var(--sb-accent))] border border-[hsl(var(--sb-accent))/0.2]">
      #{label}
    </span>
  );
}

function SidebarFile({ label, active }: { label: string; active?: boolean }) {
  return (
    <div
      className={`flex items-center gap-1.5 text-xs px-3 py-1 rounded ml-4 cursor-pointer transition-colors ${active ? "text-[hsl(var(--sb-accent))] bg-[hsl(var(--sb-accent))/0.1]" : "text-[hsl(var(--sb-text-muted))] hover:text-white hover:bg-[hsl(var(--sb-bg-hover))]"}`}
    >
      <FileText size={11} />
      {label}
    </div>
  );
}

function SidebarFolder({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <div
        className="flex items-center gap-1 text-xs px-2 py-1 rounded cursor-pointer text-[hsl(var(--sb-text-muted))] hover:text-white hover:bg-[hsl(var(--sb-bg-hover))] transition-colors"
        onClick={() => setOpen((o) => !o)}
      >
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        {label}
      </div>
      {open && <div className="mt-0.5 space-y-0.5">{children}</div>}
    </div>
  );
}

const SLASH_CMDS = [
  { icon: <Type size={13} />, label: "Text", sub: "Plain paragraph" },
  { icon: <Hash size={13} />, label: "Heading 1", sub: "Large section title" },
  { icon: <Hash size={12} />, label: "Heading 2", sub: "Medium section title" },
  {
    icon: <List size={13} />,
    label: "Bullet list",
    sub: "Simple bulleted list",
  },
  { icon: <Code size={13} />, label: "Code block", sub: "Monospaced code" },
  { icon: <Quote size={13} />, label: "Callout", sub: "Highlighted note" },
];

function EmbeddedApp() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [showSlash, setShowSlash] = useState(false);
  const [slashFilter, setSlashFilter] = useState("");
  const [slashHi, setSlashHi] = useState(0);
  const [cmdOpen, setCmdOpen] = useState(false);

  const filtered = SLASH_CMDS.filter(
    (c) =>
      !slashFilter || c.label.toLowerCase().includes(slashFilter.toLowerCase()),
  );

  const dismissSlash = () => {
    setShowSlash(false);
    setSlashFilter("");
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCmdOpen((p) => !p);
      }
      if (e.key === "Escape") {
        setCmdOpen(false);
        dismissSlash();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const onEditorKeyDown = (e: React.KeyboardEvent) => {
    if (showSlash) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashHi((h) => Math.min(h + 1, filtered.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashHi((h) => Math.max(h - 1, 0));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        dismissSlash();
        return;
      }
      if (e.key === "Escape") {
        dismissSlash();
        return;
      }
    }
  };

  const onEditorInput = (e: React.FormEvent<HTMLElement>) => {
    const text = e.currentTarget.textContent || "";
    const last = text.slice(-1);
    if (last === "/") {
      setShowSlash(true);
      setSlashFilter("");
      setSlashHi(0);
    } else if (showSlash) {
      const slashIdx = text.lastIndexOf("/");
      if (slashIdx !== -1) setSlashFilter(text.slice(slashIdx + 1));
      else dismissSlash();
    }
  };

  return (
    <div
      className="flex h-full overflow-hidden rounded-b-2xl"
      style={{ height: "clamp(300px, 60vh, 540px)" }}
    >
      {/* Sidebar */}
      <div
        className={`flex flex-col border-r border-[hsl(var(--sb-border))] bg-[hsl(var(--sb-bg-panel))] shrink-0 transition-all duration-200 ${sidebarOpen ? "w-48" : "w-0 overflow-hidden opacity-0"}`}
      >
        <div className="h-10 flex items-center justify-between px-3 border-b border-[hsl(var(--sb-border))] shrink-0">
          <div className="flex items-center gap-1.5 text-white text-xs font-semibold">
            <LogoMark size={16} />
            Robert&apos;s Brain
          </div>
          <div className="flex gap-0.5">
            <button className="p-0.5 rounded text-[hsl(var(--sb-text-faint))] hover:text-white hover:bg-[hsl(var(--sb-bg-hover))] transition-colors">
              <Bell size={11} />
            </button>
            <button className="p-0.5 rounded text-[hsl(var(--sb-text-faint))] hover:text-white hover:bg-[hsl(var(--sb-bg-hover))] transition-colors">
              <Settings size={11} />
            </button>
          </div>
        </div>

        <div className="p-2 shrink-0">
          <button
            onClick={() => setCmdOpen(true)}
            className="w-full flex items-center justify-between bg-[hsl(var(--sb-bg))] border border-[hsl(var(--sb-border))] rounded px-2 py-1 text-[10px] text-[hsl(var(--sb-text-muted))] hover:border-[hsl(var(--sb-accent))] transition-colors"
          >
            <span className="flex items-center gap-1.5">
              <Search size={11} /> Search...
            </span>
            <span className="text-[9px] bg-[hsl(var(--sb-bg-hover))] px-1 py-0.5 rounded border border-[hsl(var(--sb-border))]">
              ⌘K
            </span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-1.5 space-y-3">
          <div className="space-y-0.5">
            <div className="flex items-center gap-1.5 text-[10px] px-2 py-1 rounded text-[hsl(var(--sb-text-muted))] hover:text-white hover:bg-[hsl(var(--sb-bg-hover))] cursor-pointer transition-colors">
              <Clock size={11} /> Recent
            </div>
            <div className="flex items-center gap-1.5 text-[10px] px-2 py-1 rounded text-[hsl(var(--sb-text-muted))] hover:text-white hover:bg-[hsl(var(--sb-bg-hover))] cursor-pointer transition-colors">
              <Star size={11} /> Starred
            </div>
            <div className="flex items-center gap-1.5 text-[10px] px-2 py-1 rounded text-[hsl(var(--sb-text-muted))] hover:text-white hover:bg-[hsl(var(--sb-bg-hover))] cursor-pointer transition-colors">
              <Network size={11} /> Graph View
            </div>
          </div>
          <div>
            <div className="px-2 py-1 text-[9px] font-semibold tracking-wider text-[hsl(var(--sb-text-faint))] uppercase">
              Workspace
            </div>
            <div className="space-y-0.5 mt-0.5">
              <SidebarFolder label="Research">
                <SidebarFile label="On Networked Thought" active />
                <SidebarFile label="Zettelkasten Method" />
                <SidebarFile label="Spaced Repetition" />
              </SidebarFolder>
              <SidebarFolder label="Reading List">
                <SidebarFile label="How to Take Smart Notes" />
                <SidebarFile label="Thinking, Fast and Slow" />
              </SidebarFolder>
            </div>
          </div>
          <div>
            <div className="px-2 py-1 text-[9px] font-semibold tracking-wider text-[hsl(var(--sb-text-faint))] uppercase">
              Tags
            </div>
            <div className="flex flex-wrap gap-1 px-2 mt-1">
              <TagBadge label="design" />
              <TagBadge label="architecture" />
              <TagBadge label="idea" />
            </div>
          </div>
        </div>

        <div className="h-10 border-t border-[hsl(var(--sb-border))] flex items-center px-3 gap-2 hover:bg-[hsl(var(--sb-bg-hover))] cursor-pointer transition-colors shrink-0">
          <div className="w-5 h-5 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-600 flex items-center justify-center text-[9px] font-bold text-white">
            RC
          </div>
          <div className="text-[10px] font-medium flex-1 truncate text-[hsl(var(--sb-text))]">
            Robert Chen
          </div>
        </div>
      </div>

      {/* Main editor */}
      <div className="flex-1 flex flex-col min-w-0 relative">
        {/* Topbar */}
        <div className="h-10 border-b border-[hsl(var(--sb-border))] flex items-center justify-between px-3 shrink-0 bg-[hsl(var(--sb-bg))]">
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setSidebarOpen((o) => !o)}
              className="p-1 rounded text-[hsl(var(--sb-text-faint))] hover:text-white hover:bg-[hsl(var(--sb-bg-hover))] transition-colors"
            >
              {sidebarOpen ? (
                <ChevronLeft size={13} />
              ) : (
                <ChevronRight size={13} />
              )}
            </button>
            <div className="flex items-center gap-1 text-[11px] text-[hsl(var(--sb-text-muted))]">
              <span>Projects</span>
              <ChevronRight
                size={10}
                className="text-[hsl(var(--sb-text-faint))]"
              />
              <span className="text-white font-medium">
                On Networked Thought
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-[hsl(var(--sb-text-faint))]">
              Edited just now
            </span>
            <button className="text-[10px] font-medium px-2 py-1 rounded bg-[hsl(var(--sb-bg-panel))] border border-[hsl(var(--sb-border))] hover:border-[hsl(var(--sb-accent))] transition-colors">
              Share
            </button>
            <button
              onClick={() => setRightOpen((o) => !o)}
              className={`p-1 rounded transition-colors ${rightOpen ? "text-white bg-[hsl(var(--sb-bg-hover))]" : "text-[hsl(var(--sb-text-faint))] hover:text-white hover:bg-[hsl(var(--sb-bg-hover))]"}`}
            >
              <Network size={13} />
            </button>
            <button className="p-1 rounded text-[hsl(var(--sb-text-faint))] hover:text-white hover:bg-[hsl(var(--sb-bg-hover))] transition-colors">
              <MoreHorizontal size={13} />
            </button>
          </div>
        </div>

        <div
          className="flex-1 overflow-y-auto relative"
          onClick={() => showSlash && dismissSlash()}
        >
          <div className="max-w-xl mx-auto px-10 py-8 relative">
            <div className="mb-6 group relative">
              <BlockGutter />
              <h1
                className="text-3xl font-bold text-white mb-3 leading-tight tracking-tight outline-none"
                contentEditable
                suppressContentEditableWarning
                onKeyDown={onEditorKeyDown}
                onInput={onEditorInput}
              >
                On Networked Thought
              </h1>
              <div className="flex flex-wrap gap-1.5 mb-4">
                <TagBadge label="research" />
                <TagBadge label="cognition" />
                <button className="text-[10px] text-[hsl(var(--sb-text-faint))] hover:text-white px-1.5 py-0.5 rounded border border-dashed border-[hsl(var(--sb-border))] flex items-center gap-0.5 transition-colors">
                  <Plus size={9} /> Add tag
                </button>
              </div>
            </div>

            <div className="space-y-4 text-[13px] leading-relaxed text-[hsl(var(--sb-text))]">
              <div
                className="group relative outline-none"
                contentEditable
                suppressContentEditableWarning
                onKeyDown={onEditorKeyDown}
                onInput={onEditorInput}
              >
                <BlockGutter />
                Knowledge isn&apos;t stored in isolation — it lives in the{" "}
                <em className="text-zinc-300 not-italic">relationships</em>{" "}
                between ideas. The{" "}
                <span className="text-[hsl(var(--sb-accent))] hover:underline cursor-pointer">
                  [[Zettelkasten]]
                </span>{" "}
                method exploits this: each note is a node, and meaning emerges
                from the edges between them.
              </div>

              <div className="group relative bg-[hsl(var(--sb-accent))/0.06] border-l-2 border-[hsl(var(--sb-accent))] px-4 py-3 rounded-r-lg">
                <BlockGutter />
                <div className="flex gap-2">
                  <div className="text-[hsl(var(--sb-accent))] mt-0.5 shrink-0">
                    <Brain size={14} />
                  </div>
                  <div>
                    <div className="text-white font-semibold mb-0.5 text-[12px]">
                      Core Insight
                    </div>
                    <p className="text-[11px] text-[hsl(var(--sb-text-muted))]">
                      The goal isn&apos;t to store information. It&apos;s to
                      build a thinking partner that reflects how you already
                      reason — non-linearly, associatively, in webs.
                    </p>
                  </div>
                </div>
              </div>

              <h2
                className="group relative text-lg font-semibold text-white mt-6 mb-2 outline-none"
                contentEditable
                suppressContentEditableWarning
                onKeyDown={onEditorKeyDown}
                onInput={onEditorInput}
              >
                <BlockGutter />
                Principles
              </h2>

              <ul className="space-y-1.5">
                <li className="group relative flex gap-2 text-[13px]">
                  <BlockGutter />
                  <span className="text-[hsl(var(--sb-text-faint))]">•</span>
                  <span>
                    Ideas compound when linked to{" "}
                    <span className="text-[hsl(var(--sb-accent))] hover:underline cursor-pointer">
                      [[Spaced Repetition]]
                    </span>{" "}
                    systems
                  </span>
                </li>
                <li className="group relative flex gap-2 text-[13px]">
                  <BlockGutter />
                  <span className="text-[hsl(var(--sb-text-faint))]">•</span>
                  <span>
                    Writing is thinking made visible — see{" "}
                    <span className="text-[hsl(var(--sb-accent))] hover:underline cursor-pointer">
                      [[Feynman Technique]]
                    </span>
                  </span>
                </li>
                <li className="group relative flex gap-2 items-center text-[13px]">
                  <BlockGutter />
                  <div className="w-3.5 h-3.5 rounded border border-[hsl(var(--sb-accent))] bg-[hsl(var(--sb-accent))/0.2] flex items-center justify-center text-[hsl(var(--sb-accent))] shrink-0">
                    <CheckSquare size={10} />
                  </div>
                  <span className="text-[hsl(var(--sb-text-muted))] line-through">
                    Map your knowledge like a city, not a filing cabinet
                  </span>
                </li>
              </ul>

              <div
                className="group relative outline-none min-h-[28px] flex items-center"
                contentEditable
                suppressContentEditableWarning
                onKeyDown={onEditorKeyDown}
                onInput={onEditorInput}
                data-placeholder="Type / for blocks, or start writing..."
              >
                <BlockGutter />
              </div>

              {showSlash && filtered.length > 0 && (
                <div className="absolute left-8 z-50 w-60 bg-[hsl(var(--sb-bg-panel))] border border-[hsl(var(--sb-border))] rounded-xl shadow-2xl overflow-hidden">
                  <div className="px-3 py-2 border-b border-[hsl(var(--sb-border))] text-[9px] font-semibold text-[hsl(var(--sb-text-faint))] uppercase tracking-wider">
                    Blocks
                  </div>
                  {filtered.map((c, i) => (
                    <button
                      key={c.label}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        dismissSlash();
                      }}
                      onMouseEnter={() => setSlashHi(i)}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${i === slashHi ? "bg-indigo-600/20 text-white" : "text-[hsl(var(--sb-text))] hover:bg-[hsl(var(--sb-bg-hover))]"}`}
                    >
                      <div className="w-6 h-6 rounded border border-[hsl(var(--sb-border))] bg-[hsl(var(--sb-bg))] flex items-center justify-center text-indigo-400 shrink-0">
                        {c.icon}
                      </div>
                      <div>
                        <div className="text-[12px] font-medium">{c.label}</div>
                        <div className="text-[10px] text-[hsl(var(--sb-text-faint))]">
                          {c.sub}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div
        className={`flex flex-col border-l border-[hsl(var(--sb-border))] bg-[hsl(var(--sb-bg-panel))] shrink-0 transition-all duration-200 ${rightOpen ? "w-52" : "w-0 overflow-hidden opacity-0"}`}
      >
        <div className="h-10 border-b border-[hsl(var(--sb-border))] flex items-center px-3 text-[11px] font-semibold text-white shrink-0">
          Local Graph
        </div>
        <div className="h-44 border-b border-[hsl(var(--sb-border))] relative overflow-hidden bg-[hsl(var(--sb-bg))] flex items-center justify-center">
          <svg className="w-full h-full overflow-visible">
            <line
              x1="50%"
              y1="50%"
              x2="20%"
              y2="30%"
              stroke="hsl(var(--sb-border-hover))"
              strokeWidth="1.2"
            />
            <line
              x1="50%"
              y1="50%"
              x2="80%"
              y2="20%"
              stroke="hsl(var(--sb-border-hover))"
              strokeWidth="1.2"
            />
            <line
              x1="50%"
              y1="50%"
              x2="70%"
              y2="78%"
              stroke="hsl(var(--sb-border-hover))"
              strokeWidth="1.2"
            />
            <line
              x1="50%"
              y1="50%"
              x2="28%"
              y2="72%"
              stroke="hsl(var(--sb-border-hover))"
              strokeWidth="1.2"
            />
            <circle cx="50%" cy="50%" r="18" fill="#6366f120" />
            <circle cx="50%" cy="50%" r="5" fill="#6366f1" />
            <text
              x="50%"
              y="50%"
              dy="18"
              textAnchor="middle"
              fill="white"
              fontSize="8"
              fontWeight="500"
            >
              Networked...
            </text>
            <circle cx="20%" cy="30%" r="3" fill="hsl(var(--sb-text-muted))" />
            <text
              x="20%"
              y="30%"
              dy="11"
              textAnchor="middle"
              fill="hsl(var(--sb-text-muted))"
              fontSize="7"
            >
              Zettelkasten
            </text>
            <circle cx="80%" cy="20%" r="3" fill="hsl(var(--sb-text-muted))" />
            <text
              x="80%"
              y="20%"
              dy="11"
              textAnchor="middle"
              fill="hsl(var(--sb-text-muted))"
              fontSize="7"
            >
              Spaced Rep.
            </text>
            <circle cx="70%" cy="78%" r="3" fill="hsl(var(--sb-text-muted))" />
            <circle cx="28%" cy="72%" r="3" fill="hsl(var(--sb-text-muted))" />
          </svg>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          <div className="text-[9px] font-semibold tracking-wider text-[hsl(var(--sb-text-faint))] uppercase mb-3">
            Backlinks (2)
          </div>
          <div className="space-y-2.5">
            <div className="border border-[hsl(var(--sb-border))] bg-[hsl(var(--sb-bg))] rounded-lg p-2.5 hover:border-[hsl(var(--sb-border-hover))] cursor-pointer transition-colors">
              <div className="flex items-center justify-between mb-1.5">
                <div className="text-[11px] font-medium text-white flex items-center gap-1">
                  <FileText
                    size={10}
                    className="text-[hsl(var(--sb-accent))]"
                  />
                  Zettelkasten Method
                </div>
                <div className="text-[9px] text-[hsl(var(--sb-text-faint))]">
                  2 days ago
                </div>
              </div>
              <p className="text-[10px] text-[hsl(var(--sb-text-muted))] leading-relaxed line-clamp-2">
                Luhmann&apos;s slip-box resonates with{" "}
                <span className="text-[hsl(var(--sb-accent))]">
                  [[On Networked Thought]]
                </span>{" "}
                — both treat links as the primary unit of meaning.
              </p>
            </div>
            <div className="border border-[hsl(var(--sb-border))] bg-[hsl(var(--sb-bg))] rounded-lg p-2.5 hover:border-[hsl(var(--sb-border-hover))] cursor-pointer transition-colors">
              <div className="flex items-center justify-between mb-1.5">
                <div className="text-[11px] font-medium text-white flex items-center gap-1">
                  <FileText
                    size={10}
                    className="text-[hsl(var(--sb-accent))]"
                  />
                  Learning Systems
                </div>
                <div className="text-[9px] text-[hsl(var(--sb-text-faint))]">
                  May 14
                </div>
              </div>
              <p className="text-[10px] text-[hsl(var(--sb-text-muted))] leading-relaxed line-clamp-2">
                Every system in{" "}
                <span className="text-[hsl(var(--sb-accent))]">
                  [[On Networked Thought]]
                </span>{" "}
                benefits from deliberate review cycles and spaced repetition.
              </p>
            </div>
          </div>
        </div>
      </div>

      {cmdOpen && (
        <div className="absolute inset-0 z-50 flex items-start justify-center pt-16 rounded-2xl">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm rounded-2xl"
            onClick={() => setCmdOpen(false)}
          />
          <div className="relative w-full max-md bg-[hsl(var(--sb-bg-panel))] border border-[hsl(var(--sb-border))] rounded-xl shadow-2xl overflow-hidden">
            <div className="flex items-center px-3 h-11 border-b border-[hsl(var(--sb-border))]">
              <Search size={14} className="text-[hsl(var(--sb-text-muted))]" />
              <input
                type="text"
                placeholder="Search notes, commands, or tags..."
                className="flex-1 bg-transparent border-none text-sm px-3 text-white placeholder:text-[hsl(var(--sb-text-faint))] focus:ring-0 focus:outline-none"
                autoFocus
              />
              <div className="text-[9px] text-[hsl(var(--sb-text-faint))] bg-[hsl(var(--sb-bg))] px-1.5 py-0.5 rounded border border-[hsl(var(--sb-border))]">
                ESC
              </div>
            </div>
            <div className="p-1.5 max-h-64 overflow-y-auto">
              <div className="px-2 py-1.5 text-[9px] font-semibold text-[hsl(var(--sb-text-faint))] uppercase tracking-wider">
                Suggestions
              </div>
              <div className="px-2 py-2.5 rounded-lg bg-[hsl(var(--sb-accent))/0.1] text-[hsl(var(--sb-accent))] flex items-center justify-between cursor-pointer border border-[hsl(var(--sb-accent))/0.2] mb-1">
                <div className="flex items-center gap-2 text-xs font-medium">
                  <Plus size={13} /> Create new note
                </div>
                <div className="text-[10px] font-mono">⌘N</div>
              </div>
              <div className="px-2 py-2.5 rounded-lg text-white hover:bg-[hsl(var(--sb-bg-hover))] flex items-center justify-between cursor-pointer transition-colors">
                <div className="flex items-center gap-2 text-xs">
                  <Network
                    size={13}
                    className="text-[hsl(var(--sb-text-muted))]"
                  />{" "}
                  Open Graph View
                </div>
                <div className="text-[10px] font-mono text-[hsl(var(--sb-text-muted))]">
                  ⌘G
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function HomePage() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const graphSectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    observerRef.current = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("sb-animate-in");
            observerRef.current?.unobserve(e.target);
          }
        }),
      { threshold: 0.05 }, // Lower threshold for mobile reliability
    );
    document
      .querySelectorAll(".sb-observe")
      .forEach((el) => observerRef.current?.observe(el));
    return () => observerRef.current?.disconnect();
  }, []);

  return (
    <div className="sb-root relative overflow-hidden bg-[hsl(var(--sb-bg))] text-[hsl(var(--sb-text))]">
      <div
        className="absolute inset-0 opacity-[0.03] pointer-events-none z-10"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
          backgroundSize: "200px 200px",
        }}
      />
      <div className="absolute top-0 right-0 w-[300px] md:w-[700px] h-[300px] md:h-[700px] bg-indigo-600 blur-[120px] md:blur-[180px] opacity-[0.09] rounded-full pointer-events-none translate-x-1/3 -translate-y-1/4" />
      <div className="absolute top-1/2 left-0 w-[250px] md:w-[500px] h-[250px] md:h-[500px] bg-violet-600 blur-[100px] md:blur-[140px] opacity-[0.06] rounded-full pointer-events-none -translate-x-1/2" />

      <nav className="fixed top-0 left-0 right-0 z-50 sb-glass flex items-center justify-between px-6 md:px-8 py-4">
        <Link
          href="/"
          className="flex items-center gap-2 text-white font-medium text-lg tracking-tight hover:opacity-80 transition-opacity"
        >
          <LogoMark size={26} />
          Knowdex
        </Link>

        {/* Desktop Nav */}
        <div className="hidden md:flex gap-6">
          {[
            { label: "Features", href: "#features" },
            { label: "Graph", href: "#features" },
            { label: "Commands", href: "#features" },
          ].map((item) => (
            <a
              key={item.label}
              href={item.href}
              className="relative text-zinc-400 hover:text-white transition-colors text-sm font-medium group"
            >
              {item.label}
              <span className="absolute -bottom-1 left-0 right-0 h-px bg-indigo-500 scale-x-0 group-hover:scale-x-100 transition-transform origin-left" />
            </a>
          ))}
        </div>

        <div className="hidden md:flex gap-4 items-center">
          <Link
            href="/login"
            className="relative text-zinc-400 hover:text-white transition-colors text-sm font-medium group active:scale-95"
          >
            Log in
            <span className="absolute -bottom-1 left-0 right-0 h-px bg-indigo-500 scale-x-0 group-hover:scale-x-100 transition-transform origin-left" />
          </Link>
          <Link
            href="/register"
            className="text-sm font-semibold bg-indigo-600 text-white px-4 py-2 rounded-lg border border-indigo-500 hover:bg-indigo-500 hover:shadow-[0_4px_12px_rgba(99,102,241,0.4)] hover:-translate-y-px active:scale-[0.97] transition-all"
          >
            Get Started
          </Link>
        </div>

        {/* Mobile Nav Toggle */}
        <button
          className="md:hidden text-zinc-400 hover:text-white transition-colors active:scale-90"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        >
          {mobileMenuOpen ? (
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          ) : (
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          )}
        </button>

        {/* Mobile Menu */}
        {mobileMenuOpen && (
          <div className="absolute top-full left-0 right-0 bg-[hsl(var(--sb-bg))] border-b border-[hsl(var(--sb-border))] p-6 flex flex-col gap-6 md:hidden animate-in slide-in-from-top duration-300">
            {[
              { label: "Features", href: "#features" },
              { label: "Graph", href: "#features" },
              { label: "Commands", href: "#features" },
            ].map((item) => (
              <a
                key={item.label}
                href={item.href}
                className="text-lg text-zinc-300 hover:text-white font-medium active:scale-95 transition-all"
                onClick={() => setMobileMenuOpen(false)}
              >
                {item.label}
              </a>
            ))}
            <div className="h-px bg-white/[0.05]" />
            <Link
              href="/login"
              className="text-lg text-zinc-300 hover:text-white font-medium active:scale-95 transition-all"
              onClick={() => setMobileMenuOpen(false)}
            >
              Log in
            </Link>
            <Link
              href="/register"
              className="bg-indigo-600 text-white px-4 py-3 rounded-xl font-bold text-center active:scale-[0.98] transition-all"
              onClick={() => setMobileMenuOpen(false)}
            >
              Get Started
            </Link>
          </div>
        )}
      </nav>

      <section className="relative pt-32 md:pt-40 pb-16 md:pb-24 px-6 md:px-8 flex flex-col items-center text-center z-10">
        <div className="sb-observe inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-indigo-500/10 text-[10px] md:text-xs font-medium text-indigo-300 mb-8 border border-indigo-500/20">
          <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" />
          Knowdex 2.0 — Now in Beta
        </div>
        <h1 className="sb-observe font-semibold tracking-tighter leading-[1.1] mb-7 max-w-4xl text-[3.5rem] md:text-[5rem]">
          <span className="text-white">Your knowledge,</span>
          <br />
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-violet-500 sb-animate-drift italic pr-2 pb-4 pt-2">
            finally connected.
          </span>
        </h1>
        <p className="sb-observe text-lg md:text-xl text-zinc-400 leading-relaxed mb-10 max-w-2xl px-4 md:px-0">
          Not a note-taking app. A thinking environment built for researchers,
          engineers, and anyone who builds with ideas.
        </p>
        <div className="sb-observe flex flex-col sm:flex-row gap-4 mb-10 w-full sm:w-auto px-6 sm:px-0">
          <Link
            href="/register"
            className="bg-white text-zinc-900 px-8 py-3.5 rounded-xl font-bold hover:bg-zinc-50 transition-all shadow-[0_4px_0_rgba(255,255,255,0.25),0_8px_20px_rgba(0,0,0,0.4)] hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] active:shadow-none flex items-center justify-center gap-2 group"
          >
            <span>Start for free</span>
            <ArrowRight
              size={16}
              className="group-hover:translate-x-1 transition-transform"
            />
          </Link>
          <button className="border border-zinc-700 text-zinc-400 px-7 py-3.5 rounded-xl font-medium hover:border-zinc-500 hover:text-white transition-all active:scale-[0.98] flex items-center justify-center gap-2">
            <Command size={16} /> View demo
          </button>
        </div>
        <div className="sb-observe flex flex-wrap items-center justify-center gap-y-4 gap-x-5 md:gap-8 text-[11px] md:text-sm text-zinc-600">
          <div className="flex items-center gap-1">
            {[...Array(5)].map((_, i) => (
              <Star
                key={i}
                size={12}
                className="text-yellow-400 fill-yellow-400"
              />
            ))}
            <span className="ml-1.5">4.9 / 5</span>
          </div>
          <span className="hidden sm:inline text-zinc-800">·</span>
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />
            12,000+ researchers
          </span>
          <span className="hidden sm:inline text-zinc-800">·</span>
          <span>50M+ notes synced</span>
        </div>
      </section>
      <section className="px-6 md:px-8 pb-10 relative z-10">
        <div className="max-w-6xl mx-auto">
          <div className="hidden md:flex items-center gap-3 mb-4 justify-center">
            <div className="h-px flex-1 bg-white/[0.04]" />
            <span className="text-[11px] text-zinc-600 font-medium tracking-wide uppercase">
              Live editor — click anywhere to edit
            </span>
            <div className="h-px flex-1 bg-white/[0.04]" />
          </div>
          <div
            className="hidden md:block rounded-2xl overflow-hidden border border-[hsl(var(--sb-border))]"
            style={{
              boxShadow:
                "0 40px 100px -20px rgba(0,0,0,0.9), 0 0 0 1px rgba(255,255,255,0.04), 0 0 80px -20px rgba(99,102,241,0.2)",
              transform: "perspective(1800px) rotateX(2deg)",
            }}
          >
            <div className="h-9 sb-glass flex items-center px-4 gap-2 border-b border-[hsl(var(--sb-border))] shrink-0">
              <div className="w-2.5 h-2.5 rounded-full bg-red-500/40 border border-red-500/70" />
              <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/40 border border-yellow-500/70" />
              <div className="w-2.5 h-2.5 rounded-full bg-green-500/40 border border-green-500/70" />
              <div className="mx-auto text-[10px] text-[hsl(var(--sb-text-faint))] flex items-center gap-1">
                <Command size={9} />K — Knowdex
              </div>
              <div className="text-[9px] text-zinc-600 font-medium">
                Click to edit
              </div>
            </div>
            <EmbeddedApp />
          </div>
          <div className="hidden md:block pointer-events-none absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t from-[hsl(var(--sb-bg))] to-transparent" />
        </div>
      </section>

      <section id="features" className="py-24 px-8">
        <div className="max-w-6xl mx-auto">
          <div className="mb-14">
            <div className="text-xs font-semibold text-indigo-400 tracking-widest uppercase mb-3">
              Features
            </div>
            <h2 className="text-4xl font-semibold text-white mb-3">
              Everything connects.
            </h2>
            <p className="text-zinc-500 text-lg max-w-lg">
              Links are first-class citizens. Your knowledge builds a web, not a
              hierarchy — and it answers back.
            </p>
          </div>

          <div className="flex flex-col gap-0">
            {(
              [
                {
                  icon: <Network size={20} />,
                  accent: "indigo",
                  title: "Bi-directional Links",
                  desc: "Every time you link an idea, we automatically create a backlink. Your knowledge forms a living web — not a dead hierarchy.",
                  tags: ["Automatic", "Graph-powered"],
                  reverse: false,
                  visual: <BiLinksVisual />,
                },
                {
                  icon: <Brain size={20} />,
                  accent: "violet",
                  title: "Graph View",
                  desc: "Visualize your entire knowdex in one canvas. Clusters get their own colour, and ghost links surface notes that are about the same thing but not yet connected.",
                  tags: ["Ghost links", "Interactive"],
                  reverse: true,
                  visual: <GraphViewVisual />,
                },
                {
                  icon: <Command size={20} />,
                  accent: "indigo",
                  title: "Command Palette",
                  desc: "Never take your hands off the keyboard. Navigate, create, link, and organize through fuzzy-matched keystrokes in under 100ms.",
                  tags: ["Fuzzy Match", "Extensible"],
                  reverse: false,
                  visual: <CommandPaletteVisual />,
                },
                {
                  icon: <MessageSquareText size={20} />,
                  accent: "violet",
                  title: "Ask Your Notes",
                  desc: "Ask a question in plain language and get an answer written from your own notes and PDFs, with numbered citations you can click to open the source.",
                  tags: ["Cited answers", "PDF search"],
                  reverse: true,
                  visual: <AskVisual />,
                },
                {
                  icon: <Table2 size={20} />,
                  accent: "indigo",
                  title: "Databases & Boards",
                  desc: "Turn any set of notes into a database with typed properties, then switch between table and kanban views. Every row is still a full note.",
                  tags: ["Table", "Kanban"],
                  reverse: false,
                  visual: <DatabaseVisual />,
                },
                {
                  icon: <CloudOff size={20} />,
                  accent: "violet",
                  title: "Offline-first & Publish",
                  desc: "Keep writing on a plane: edits are stored on your device and merged when you reconnect. Flip a switch to publish any note as a clean public page.",
                  tags: ["Works offline", "Public pages"],
                  reverse: true,
                  visual: <OfflineVisual />,
                },
              ] as const
            ).map((f, i) => (
              <div
                key={f.title}
                className={`sb-observe flex flex-col ${f.reverse ? "lg:flex-row-reverse" : "lg:flex-row"} items-center gap-10 lg:gap-20 py-16 lg:py-20 border-t ${i === 5 ? "border-b " : ""}border-white/[0.05]`}
                style={{ animationDelay: `${i * 0.1}s` }}
              >
                <div className="w-full lg:flex-1">
                  <div
                    className={`w-10 h-10 rounded-xl ${f.accent === "violet" ? "bg-violet-500/10" : "bg-indigo-500/10"} flex items-center justify-center ${f.accent === "violet" ? "text-violet-400" : "text-indigo-400"} mb-6`}
                  >
                    {f.icon}
                  </div>
                  <h3 className="text-2xl font-semibold text-white mb-4">
                    {f.title}
                  </h3>
                  <p className="text-zinc-500 leading-relaxed mb-7 text-[1.05rem]">
                    {f.desc}
                  </p>
                  <div className="flex flex-wrap gap-2 mb-7">
                    {f.tags.map((t) => (
                      <span
                        key={t}
                        className="text-xs bg-white/[0.04] border border-white/[0.07] text-zinc-400 px-3 py-1.5 rounded-full font-medium"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                  <Link
                    href="/register"
                    className={`inline-flex items-center gap-1.5 text-sm font-medium ${f.accent === "violet" ? "text-violet-400 hover:text-violet-300" : "text-indigo-400 hover:text-indigo-300"} active:translate-x-1 transition-all group`}
                  >
                    Learn more{" "}
                    <ArrowRight
                      size={14}
                      className="group-hover:translate-x-1 transition-transform"
                    />
                  </Link>
                </div>
                <div
                  className={`w-full lg:flex-1 rounded-2xl bg-[hsl(var(--sb-bg-panel))] overflow-hidden group/v relative transition-all duration-300 border ${f.accent === "violet" ? "border-violet-500/10 hover:border-violet-500/20 hover:shadow-[0_0_48px_-12px_rgba(139,92,246,0.25)]" : "border-indigo-500/10 hover:border-indigo-500/20 hover:shadow-[0_0_48px_-12px_rgba(99,102,241,0.25)]"} active:scale-[0.99] ${f.title === "Bi-directional Links" ? "h-auto py-8 sm:py-0 lg:h-[300px]" : "h-[260px] sm:h-[320px] lg:h-[300px]"}`}
                >
                  {f.visual}
                  <div className="absolute inset-0 bg-indigo-600/0 group-hover/v:bg-indigo-600/[0.03] transition-colors pointer-events-none" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20 md:py-28 px-6 md:px-8 border-y border-white/[0.04] bg-[hsl(var(--sb-bg-panel))] overflow-hidden relative">
        <div className="max-w-7xl mx-auto flex flex-col lg:flex-row items-center gap-12 lg:gap-16 relative z-20">
          <div className="w-full lg:flex-1">
            <div className="text-xs font-semibold text-indigo-400 tracking-widest uppercase mb-4">
              Graph View
            </div>
            <h2 className="text-3xl md:text-5xl font-semibold text-white mb-6 leading-tight">
              See the shape of
              <br />
              your knowledge.
            </h2>
            <p className="text-base md:text-lg text-zinc-500 mb-8 leading-relaxed">
              The human brain works by association. Knowdex&apos;s interactive
              graph maps your thoughts visually — drag nodes, explore clusters,
              watch physics do the rest.
            </p>
            <ul className="space-y-3 text-zinc-500 text-sm">
              {[
                "Color-coded node clusters",
                "Force-directed physics engine",
                "Real-time filtering and querying",
              ].map((t) => (
                <li key={t} className="flex items-center gap-3">
                  <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 shrink-0" />
                  {t}
                </li>
              ))}
            </ul>
          </div>
          <div className="w-full lg:flex-1 relative" ref={graphSectionRef}>
            <PhysicsGraph />
            <div
              className="pointer-events-none absolute bottom-5 left-1/2 -translate-x-1/2 flex items-center gap-2 px-3.5 py-2 rounded-full border border-white/[0.1] text-xs text-zinc-300 font-medium"
              style={{
                background: "rgba(15,15,20,0.75)",
                backdropFilter: "blur(12px)",
                boxShadow:
                  "0 4px 24px rgba(0,0,0,0.4), 0 0 0 1px rgba(99,102,241,0.15)",
                animation:
                  "sb-hint-in 0.5s ease 1.2s both, sb-hint-out 0.6s ease 5s both",
              }}
            >
              <svg
                width="13"
                height="17"
                viewBox="0 0 13 17"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                style={{ flexShrink: 0 }}
              >
                <rect
                  x="0.75"
                  y="0.75"
                  width="11.5"
                  height="15.5"
                  rx="5.25"
                  stroke="#a5b4fc"
                  strokeWidth="1.5"
                />
                <line
                  x1="6.5"
                  y1="3.5"
                  x2="6.5"
                  y2="6.5"
                  stroke="#a5b4fc"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
              Drag any node to explore
              <span className="relative flex h-2 w-2 ml-0.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-50" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500" />
              </span>
            </div>
            <style
              dangerouslySetInnerHTML={{
                __html: `
              @keyframes sb-hint-in  { from { opacity:0; transform:translate(-50%,8px); } to { opacity:1; transform:translate(-50%,0); } }
              @keyframes sb-hint-out { from { opacity:1; } to { opacity:0; pointer-events:none; } }
            `,
              }}
            />
          </div>
        </div>
      </section>

      <section
        className="relative py-40 px-8 overflow-hidden"
        style={{ background: "hsl(240,10%,5%)" }}
      >
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none"
          preserveAspectRatio="xMidYMid slice"
          xmlns="http://www.w3.org/2000/svg"
        >
          <line
            x1="15%"
            y1="20%"
            x2="40%"
            y2="50%"
            stroke="#6366f1"
            strokeWidth="1"
            strokeOpacity="0.07"
          />
          <line
            x1="40%"
            y1="50%"
            x2="70%"
            y2="30%"
            stroke="#6366f1"
            strokeWidth="1"
            strokeOpacity="0.07"
          />
          <line
            x1="70%"
            y1="30%"
            x2="88%"
            y2="72%"
            stroke="#8b5cf6"
            strokeWidth="1"
            strokeOpacity="0.07"
          />
          <line
            x1="40%"
            y1="50%"
            x2="25%"
            y2="80%"
            stroke="#6366f1"
            strokeWidth="1"
            strokeOpacity="0.06"
          />
          <line
            x1="40%"
            y1="50%"
            x2="60%"
            y2="78%"
            stroke="#8b5cf6"
            strokeWidth="1"
            strokeOpacity="0.06"
          />
          <line
            x1="70%"
            y1="30%"
            x2="55%"
            y2="15%"
            stroke="#6366f1"
            strokeWidth="1"
            strokeOpacity="0.05"
          />
          <circle cx="15%" cy="20%" r="4" fill="#6366f1" fillOpacity="0.18" />
          <circle cx="40%" cy="50%" r="6" fill="#6366f1" fillOpacity="0.22" />
          <circle cx="70%" cy="30%" r="5" fill="#8b5cf6" fillOpacity="0.18" />
          <circle cx="88%" cy="72%" r="3" fill="#8b5cf6" fillOpacity="0.12" />
          <circle cx="25%" cy="80%" r="3" fill="#6366f1" fillOpacity="0.1" />
          <circle cx="60%" cy="78%" r="4" fill="#8b5cf6" fillOpacity="0.12" />
          <circle cx="55%" cy="15%" r="3" fill="#6366f1" fillOpacity="0.1" />
        </svg>
        <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
          <div
            style={{
              width: "700px",
              height: "500px",
              background:
                "radial-gradient(ellipse, rgba(99,102,241,0.18) 0%, transparent 65%)",
              borderRadius: "50%",
            }}
          />
        </div>

        <div className="sb-observe relative z-10 max-w-4xl mx-auto text-center px-6">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/[0.04] border border-white/[0.08] text-zinc-300 text-[10px] md:text-xs font-medium mb-10">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-60" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-400" />
            </span>
            12,000+ people building their knowdex right now
          </div>

          <h2 className="font-semibold tracking-tighter leading-[1.06] mb-6 text-[2.75rem] md:text-[3.75rem]">
            <span className="text-white">Your knowdex</span>
            <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-300 via-violet-300 to-indigo-400">
              starts here.
            </span>
          </h2>

          <p className="text-base md:text-lg text-zinc-500 mb-12 max-w-lg mx-auto leading-relaxed">
            Join the researchers, engineers, and writers who turned scattered
            notes into a connected knowledge system.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-16 px-6 sm:px-0">
            <Link
              href="/register"
              className="w-full sm:w-auto bg-white text-zinc-900 px-10 py-4 rounded-xl font-bold text-lg hover:bg-zinc-50 transition-all hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] shadow-[0_8px_40px_rgba(0,0,0,0.5),0_0_0_1px_rgba(255,255,255,0.1)] active:shadow-none flex items-center justify-center gap-2 group"
            >
              <span>Start for free</span>
              <ArrowRight
                size={18}
                className="group-hover:translate-x-1 transition-transform"
              />
            </Link>
            <Link
              href="/login"
              className="w-full sm:w-auto border border-zinc-700 text-zinc-400 px-8 py-4 rounded-xl font-medium text-lg hover:border-zinc-500 hover:text-white transition-all active:scale-[0.98] text-center"
            >
              Sign in
            </Link>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-8 md:gap-10">
            {[
              { value: "50M+", label: "notes synced" },
              { value: "4.9★", label: "avg rating" },
              { value: "Free", label: "no card needed" },
            ].map((s, i, arr) => (
              <React.Fragment key={s.label}>
                <div className="flex flex-col items-center">
                  <span className="text-xl md:text-2xl font-bold text-white tracking-tight">
                    {s.value}
                  </span>
                  <span className="text-zinc-600 text-[10px] md:text-xs mt-0.5">
                    {s.label}
                  </span>
                </div>
                {i < arr.length - 1 && (
                  <div className="hidden sm:block w-px h-8 bg-white/[0.06]" />
                )}
              </React.Fragment>
            ))}
          </div>
        </div>
      </section>

      <footer className="border-t border-white/[0.04] py-10 px-6 md:px-8 text-zinc-600 text-sm">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-8 md:gap-4">
          <div className="flex items-center gap-2 text-white font-medium">
            <LogoMark size={18} />
            Knowdex
          </div>
          <div className="flex gap-6">
            {["Twitter", "GitHub", "Discord"].map((l) => (
              <a
                key={l}
                href={`https://${l.toLowerCase()}.com`}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-white transition-colors"
              >
                {l}
              </a>
            ))}
          </div>
          <div className="text-zinc-700">© 2025 Knowdex Inc.</div>
        </div>
      </footer>
    </div>
  );
}
