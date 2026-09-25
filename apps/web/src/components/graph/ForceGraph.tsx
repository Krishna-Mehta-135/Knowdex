"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  distToSegment,
  ForceSim,
  FULL_OPTIONS,
  MINI_OPTIONS,
  type SimNode,
} from "@/lib/graph/forceSim";
import type { GraphData, GraphNode } from "@/lib/kx/api";

interface Props {
  data: GraphData;
  activeId?: string | null;
  mini?: boolean;
  showGhost?: boolean;
  /** Only nodes created at or before this time are shown (timeline). */
  until?: number | null;
  /** Highlight nodes whose title matches. */
  query?: string;
  /** Emphasise a suggested pair (from the suggestions panel). */
  focusPair?: { a: string; b: string } | null;
  onOpen?: (node: GraphNode) => void;
  className?: string;
}

interface View {
  k: number;
  x: number;
  y: number;
}

const ACCENT = "hsl(255 85% 68%)";
const GHOST = "hsl(285 90% 72%)";
const FILE = "hsl(38 92% 60%)";

const radiusOf = (n: GraphNode, mini: boolean) =>
  (mini ? 2.6 : 4) + Math.sqrt(n.degree) * (mini ? 0.9 : 1.6);

/**
 * Canvas force graph. The simulation and render loop only run while something
 * is moving, so an idle graph costs no CPU (unlike per-frame React state).
 */
export function ForceGraph({
  data,
  activeId,
  mini = false,
  showGhost = true,
  until = null,
  query = "",
  focusPair = null,
  onOpen,
  className,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sim = useRef<ForceSim>(
    new ForceSim(mini ? MINI_OPTIONS : FULL_OPTIONS),
  );
  const view = useRef<View>({ k: 1, x: 0, y: 0 });
  const size = useRef({ w: 300, h: 200, dpr: 1 });
  const raf = useRef(0);
  const dirty = useRef(true);
  const hover = useRef<{ node: string | null; ghost: number | null }>({
    node: null,
    ghost: null,
  });
  const drag = useRef<{
    id: string;
    moved: boolean;
    sx: number;
    sy: number;
  } | null>(null);
  const pan = useRef<{ x: number; y: number } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<number | null>(null);
  const userMoved = useRef(false);
  const nodeMeta = useRef(new Map<string, GraphNode>());
  const latest = useRef({
    activeId,
    query,
    focusPair,
    adjacency: new Map<string, Set<string>>(),
  });
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(
    null,
  );

  const visible = useMemo(() => {
    const nodes = data.nodes.filter(
      (n) => until === null || n.createdAt <= until,
    );
    const ids = new Set(nodes.map((n) => n.id));
    return { nodes, ids };
  }, [data.nodes, until]);

  const adjacency = useMemo(() => {
    const m = new Map<string, Set<string>>();
    const add = (a: string, b: string) => {
      if (!m.has(a)) m.set(a, new Set());
      m.get(a)!.add(b);
    };
    for (const e of data.edges) {
      add(e.a, e.b);
      add(e.b, e.a);
    }
    for (const n of data.nodes)
      if (n.parentId) {
        add(n.id, n.parentId);
        add(n.parentId, n.id);
      }
    return m;
  }, [data]);

  latest.current = { activeId, query, focusPair, adjacency };

  /** Mini mode shows only the active note's neighbourhood. */
  const scope = useMemo(() => {
    if (!mini || !activeId) return null;
    const s = new Set<string>([activeId]);
    for (const id of adjacency.get(activeId) ?? []) s.add(id);
    for (const g of data.ghostEdges) {
      if (g.a === activeId) s.add(g.b);
      if (g.b === activeId) s.add(g.a);
    }
    return s;
  }, [mini, activeId, adjacency, data.ghostEdges]);

  const requestDraw = useCallback(() => {
    dirty.current = true;
    if (!raf.current) raf.current = requestAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── data → simulation ────────────────────────────────────────────────────
  useEffect(() => {
    const s = sim.current;
    const nodes = visible.nodes.filter((n) => !scope || scope.has(n.id));
    const ids = new Set(nodes.map((n) => n.id));
    nodeMeta.current = new Map(nodes.map((n) => [n.id, n]));
    const links = [
      ...data.edges.filter((e) => ids.has(e.a) && ids.has(e.b)),
      ...data.nodes
        .filter((n) => n.parentId && ids.has(n.id) && ids.has(n.parentId))
        .map((n) => ({ a: n.id, b: n.parentId! })),
      ...(showGhost
        ? data.ghostEdges
            .filter((g) => ids.has(g.a) && ids.has(g.b))
            .map((g) => ({ a: g.a, b: g.b, ghost: true, score: g.score }))
        : []),
    ];
    s.setData(
      nodes.map((n) => ({ id: n.id, r: radiusOf(n, mini) })),
      links,
    );
    if (!userMoved.current && nodes.length > 0) {
      // Pre-settle a little so the first paint is not a tangled ball.
      if (s.alpha > 0.9) for (let i = 0; i < 60; i++) s.tick();
      fitToView();
    }
    requestDraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, scope, showGhost, data, mini]);

  // ── sizing ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ro = new ResizeObserver(() => {
      const r = wrap.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      size.current = {
        w: Math.max(50, r.width),
        h: Math.max(50, r.height),
        dpr,
      };
      canvas.width = Math.round(size.current.w * dpr);
      canvas.height = Math.round(size.current.h * dpr);
      canvas.style.width = `${size.current.w}px`;
      canvas.style.height = `${size.current.h}px`;
      if (!userMoved.current) fitToView();
      requestDraw();
    });
    ro.observe(wrap);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    requestDraw();
  }, [activeId, query, focusPair, requestDraw]);

  useEffect(
    () => () => {
      cancelAnimationFrame(raf.current);
      raf.current = 0;
    },
    [],
  );

  function fitToView() {
    const b = sim.current.bounds();
    const { w, h } = size.current;
    const pad = mini ? 14 : 60;
    const bw = Math.max(1, b.maxX - b.minX);
    const bh = Math.max(1, b.maxY - b.minY);
    const k = Math.min(
      mini ? 2.2 : 1.6,
      (w - pad * 2) / bw,
      (h - pad * 2) / bh,
    );
    view.current = {
      k,
      x: w / 2 - ((b.minX + b.maxX) / 2) * k,
      y: h / 2 - ((b.minY + b.maxY) / 2) * k,
    };
  }

  // ── render loop ──────────────────────────────────────────────────────────
  function frame() {
    raf.current = 0;
    const s = sim.current;
    const wasActive = s.active;
    if (wasActive) {
      s.tick();
      if (!userMoved.current) fitToView();
    }
    draw();
    if (s.active || dirty.current) {
      dirty.current = false;
      raf.current = requestAnimationFrame(frame);
    }
    if (!s.active && wasActive) dirty.current = false;
  }

  function draw() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const { w, h, dpr } = size.current;
    const v = view.current;
    const s = sim.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.setTransform(dpr * v.k, 0, 0, dpr * v.k, dpr * v.x, dpr * v.y);

    const { activeId, query, focusPair, adjacency } = latest.current;
    const hv = hover.current;
    const focusId = hv.node ?? activeId ?? null;
    const neighbours = focusId ? adjacency.get(focusId) : undefined;
    const q = query.trim().toLowerCase();
    const isMatch = (id: string) =>
      q && (nodeMeta.current.get(id)?.title ?? "").toLowerCase().includes(q);
    const dimAll = Boolean(hv.node) || Boolean(q);
    const px = 1 / v.k;

    // links
    for (let i = 0; i < s.links.length; i++) {
      const l = s.links[i]!;
      const emph =
        (focusId && (l.a === focusId || l.b === focusId)) ||
        (focusPair &&
          ((l.a === focusPair.a && l.b === focusPair.b) ||
            (l.a === focusPair.b && l.b === focusPair.a))) ||
        hv.ghost === i;
      ctx.beginPath();
      ctx.moveTo(l.s.x, l.s.y);
      ctx.lineTo(l.t.x, l.t.y);
      if (l.ghost) {
        ctx.setLineDash([5 * px, 5 * px]);
        ctx.strokeStyle = GHOST;
        ctx.globalAlpha = emph
          ? 0.95
          : dimAll
            ? 0.12
            : 0.28 + Math.min(0.4, l.score * 0.4);
        ctx.lineWidth = (emph ? 2 : 1.1) * px;
      } else {
        ctx.setLineDash([]);
        ctx.strokeStyle = emph ? "#fff" : "rgba(255,255,255,1)";
        ctx.globalAlpha = emph ? 0.9 : dimAll ? 0.06 : 0.2;
        ctx.lineWidth = (emph ? 1.8 : 1) * px;
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // nodes
    const labelAll = !mini && v.k > 1.35;
    for (const n of s.nodes) {
      const meta = nodeMeta.current.get(n.id);
      const isActive = n.id === activeId;
      const isHover = n.id === hv.node;
      const near = neighbours?.has(n.id) ?? false;
      const pair = focusPair && (n.id === focusPair.a || n.id === focusPair.b);
      const matched = q ? isMatch(n.id) : false;
      const dim = (hv.node && !isHover && !near) || (q && !matched);
      ctx.globalAlpha = dim && !pair ? 0.15 : 1;
      const color =
        meta?.kind === "file"
          ? FILE
          : isActive || pair
            ? ACCENT
            : matched
              ? "#fff"
              : near || isHover
                ? "#fff"
                : "rgba(255,255,255,0.6)";
      if (isActive || isHover || pair) {
        ctx.shadowColor = isActive || pair ? ACCENT : "#fff";
        ctx.shadowBlur = 14;
      }
      ctx.fillStyle = color;
      ctx.beginPath();
      if (meta?.kind === "file") {
        const r = n.r;
        ctx.rect(n.x - r, n.y - r, r * 2, r * 2);
      } else {
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      }
      ctx.fill();
      ctx.shadowBlur = 0;

      const showLabel =
        isActive ||
        isHover ||
        near ||
        pair ||
        matched ||
        (labelAll && !dim) ||
        (mini && isActive);
      if (showLabel && meta) {
        const t =
          meta.title.length > 26 ? `${meta.title.slice(0, 24)}…` : meta.title;
        ctx.font = `${(mini ? 9 : 12) * px}px ui-sans-serif, system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.fillStyle = isActive || pair ? ACCENT : "rgba(255,255,255,0.92)";
        ctx.globalAlpha = dim && !pair ? 0.2 : 1;
        ctx.fillText(t, n.x, n.y + n.r + (mini ? 10 : 15) * px);
      }
    }
    ctx.globalAlpha = 1;
  }

  // ── interaction ──────────────────────────────────────────────────────────
  const toWorld = (cx: number, cy: number) => {
    const r = canvasRef.current!.getBoundingClientRect();
    const v = view.current;
    return {
      x: (cx - r.left - v.x) / v.k,
      y: (cy - r.top - v.y) / v.k,
      sx: cx - r.left,
      sy: cy - r.top,
    };
  };

  const hitNode = (wx: number, wy: number): SimNode | null => {
    const slack = 5 / view.current.k;
    let best: SimNode | null = null;
    let bd = Infinity;
    for (const n of sim.current.nodes) {
      const d = Math.hypot(n.x - wx, n.y - wy);
      if (d <= n.r + slack && d < bd) {
        best = n;
        bd = d;
      }
    }
    return best;
  };

  const hitGhost = (wx: number, wy: number): number | null => {
    const tol = 6 / view.current.k;
    const links = sim.current.links;
    for (let i = 0; i < links.length; i++) {
      const l = links[i]!;
      if (l.ghost && distToSegment(wx, wy, l.s.x, l.s.y, l.t.x, l.t.y) < tol)
        return i;
    }
    return null;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      drag.current = null;
      pan.current = null;
      return;
    }
    const w = toWorld(e.clientX, e.clientY);
    const n = hitNode(w.x, w.y);
    userMoved.current = true;
    if (n) {
      drag.current = { id: n.id, moved: false, sx: e.clientX, sy: e.clientY };
      n.fx = n.x;
      n.fy = n.y;
      sim.current.reheat(0.3);
    } else {
      pan.current = { x: e.clientX, y: e.clientY };
    }
    requestDraw();
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (pointers.current.has(e.pointerId))
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      zoomAt((a!.x + b!.x) / 2, (a!.y + b!.y) / 2, dist / pinch.current);
      pinch.current = dist;
      return;
    }
    if (drag.current) {
      const d = drag.current;
      if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 4) d.moved = true;
      const n = sim.current.node(d.id);
      if (n) {
        const w = toWorld(e.clientX, e.clientY);
        n.fx = w.x;
        n.fy = w.y;
        sim.current.reheat(0.3);
      }
      requestDraw();
      return;
    }
    if (pan.current) {
      view.current.x += e.clientX - pan.current.x;
      view.current.y += e.clientY - pan.current.y;
      pan.current = { x: e.clientX, y: e.clientY };
      requestDraw();
      return;
    }
    if (e.pointerType === "touch") return;
    const w = toWorld(e.clientX, e.clientY);
    const n = hitNode(w.x, w.y);
    const g = n ? null : hitGhost(w.x, w.y);
    if (hover.current.node !== (n?.id ?? null) || hover.current.ghost !== g) {
      hover.current = { node: n?.id ?? null, ghost: g };
      if (g !== null) {
        const l = sim.current.links[g]!;
        const ta = nodeMeta.current.get(l.a)?.title ?? "?";
        const tb = nodeMeta.current.get(l.b)?.title ?? "?";
        setTip({
          x: w.sx,
          y: w.sy,
          text: `Similar: ${ta} ↔ ${tb} (${Math.round(l.score * 100)}%)`,
        });
      } else if (n && nodeMeta.current.get(n.id)) {
        setTip(
          mini
            ? { x: w.sx, y: w.sy, text: nodeMeta.current.get(n.id)!.title }
            : null,
        );
      } else setTip(null);
      requestDraw();
    }
  };

  const endPointer = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    const d = drag.current;
    if (d) {
      const n = sim.current.node(d.id);
      if (n) {
        n.fx = null;
        n.fy = null;
      }
      if (!d.moved) {
        const meta = nodeMeta.current.get(d.id);
        if (meta) onOpen?.(meta);
      }
    }
    drag.current = null;
    pan.current = null;
    requestDraw();
  };

  const onLeave = () => {
    hover.current = { node: null, ghost: null };
    setTip(null);
    requestDraw();
  };

  function zoomAt(cx: number, cy: number, factor: number) {
    const r = canvasRef.current!.getBoundingClientRect();
    const v = view.current;
    const k = Math.max(0.15, Math.min(6, v.k * factor));
    const f = k / v.k;
    const mx = cx - r.left;
    const my = cy - r.top;
    v.x = mx - (mx - v.x) * f;
    v.y = my - (my - v.y) * f;
    v.k = k;
    userMoved.current = true;
    requestDraw();
  }

  useEffect(() => {
    const el = canvasRef.current;
    if (!el || mini) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mini]);

  return (
    <div ref={wrapRef} className={`relative w-full h-full ${className ?? ""}`}>
      <canvas
        ref={canvasRef}
        className="block touch-none cursor-grab active:cursor-grabbing"
        style={{ cursor: hover.current.node ? "pointer" : undefined }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onPointerLeave={onLeave}
        aria-label="Knowledge graph"
        role="img"
      />
      {tip && (
        <div
          className="pointer-events-none absolute z-10 max-w-[260px] rounded-md border border-white/10 bg-black/80 px-2 py-1 text-[11px] text-white/90 backdrop-blur"
          style={{
            left: Math.min(tip.x + 12, size.current.w - 200),
            top: tip.y + 12,
          }}
        >
          {tip.text}
        </div>
      )}
    </div>
  );
}
