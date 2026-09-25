/**
 * Small force-directed layout (d3-force style, no dependency).
 * Pure & deterministic so it can be unit-tested; rendering lives elsewhere.
 * The simulation "cools" (alpha → 0) and then stops costing any CPU.
 */
export interface SimNode {
  id: string;
  r: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Pinned position while dragging. */
  fx: number | null;
  fy: number | null;
}

export interface SimLink {
  a: string;
  b: string;
  s: SimNode;
  t: SimNode;
  ghost: boolean;
  score: number;
}

export interface SimOptions {
  repulsion: number;
  linkDistance: number;
  linkStrength: number;
  gravity: number;
}

export const FULL_OPTIONS: SimOptions = {
  repulsion: 3200,
  linkDistance: 38,
  linkStrength: 0.5,
  gravity: 0.03,
};
export const MINI_OPTIONS: SimOptions = {
  repulsion: 700,
  linkDistance: 26,
  linkStrength: 0.4,
  gravity: 0.08,
};

const ALPHA_MIN = 0.003;
const ALPHA_DECAY = 0.0228;
const VELOCITY_DECAY = 0.42;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
/** Beyond this distance (px) repulsion is ignored — keeps it O(n) for sparse layouts. */
const REPULSE_CUTOFF2 = 420 * 420;

export class ForceSim {
  public nodes: SimNode[] = [];
  public links: SimLink[] = [];
  public alpha = 1;
  private byId = new Map<string, SimNode>();

  public constructor(public options: SimOptions = FULL_OPTIONS) {}

  public get active(): boolean {
    return this.alpha > ALPHA_MIN;
  }

  public node(id: string): SimNode | undefined {
    return this.byId.get(id);
  }

  /**
   * Replace graph data, keeping positions of nodes that already exist. New
   * nodes spawn next to an existing neighbour so growth looks organic.
   */
  public setData(
    nodesIn: { id: string; r: number }[],
    linksIn: { a: string; b: string; ghost?: boolean; score?: number }[],
  ): void {
    const prev = this.byId;
    const next = new Map<string, SimNode>();
    const nodes: SimNode[] = [];
    let fresh = 0;
    nodesIn.forEach((n, i) => {
      if (next.has(n.id)) return;
      const old = prev.get(n.id);
      if (old) {
        old.r = n.r;
        next.set(n.id, old);
        nodes.push(old);
        return;
      }
      const radius = 14 * Math.sqrt(i + 0.5);
      const angle = i * GOLDEN;
      const node: SimNode = {
        id: n.id,
        r: n.r,
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
        vx: 0,
        vy: 0,
        fx: null,
        fy: null,
      };
      next.set(n.id, node);
      nodes.push(node);
      fresh++;
    });

    const seen = new Set<string>();
    const links: SimLink[] = [];
    for (const l of linksIn) {
      const s = next.get(l.a);
      const t = next.get(l.b);
      if (!s || !t || s === t) continue;
      const key =
        l.a < l.b
          ? `${l.a}|${l.b}|${l.ghost ? 1 : 0}`
          : `${l.b}|${l.a}|${l.ghost ? 1 : 0}`;
      if (seen.has(key)) continue;
      seen.add(key);
      links.push({
        a: l.a,
        b: l.b,
        s,
        t,
        ghost: Boolean(l.ghost),
        score: l.score ?? 0,
      });
    }

    // Place brand-new nodes near an already-positioned neighbour.
    if (prev.size > 0) {
      for (const l of links) {
        for (const [n, other] of [
          [l.s, l.t],
          [l.t, l.s],
        ] as const) {
          if (!prev.has(n.id) && prev.has(other.id) && !l.ghost) {
            n.x = other.x + (Math.random() - 0.5) * 30;
            n.y = other.y + (Math.random() - 0.5) * 30;
          }
        }
      }
    }

    this.nodes = nodes;
    this.links = links;
    this.byId = next;
    this.alpha =
      fresh > 0 ? (prev.size === 0 ? 1 : 0.5) : Math.max(this.alpha, 0.15);
  }

  public reheat(alpha = 0.5): void {
    this.alpha = Math.max(this.alpha, alpha);
  }

  public tick(): void {
    if (!this.active) return;
    const { repulsion, linkDistance, linkStrength, gravity } = this.options;
    const a = this.alpha;
    const ns = this.nodes;
    const n = ns.length;

    for (let i = 0; i < n; i++) {
      const p = ns[i]!;
      p.vx -= p.x * gravity * a;
      p.vy -= p.y * gravity * a;
      for (let j = i + 1; j < n; j++) {
        const q = ns[j]!;
        let dx = q.x - p.x;
        let dy = q.y - p.y;
        let d2 = dx * dx + dy * dy;
        if (d2 > REPULSE_CUTOFF2) continue;
        if (d2 < 0.01) {
          dx = (Math.random() - 0.5) * 0.1;
          dy = (Math.random() - 0.5) * 0.1;
          d2 = dx * dx + dy * dy + 0.01;
        }
        const d = Math.sqrt(d2);
        let f = (repulsion * a) / d2;
        const minD = p.r + q.r + 6;
        if (d < minD) f += ((minD - d) / d) * 0.5;
        const fx = (dx / d) * f;
        const fy = (dy / d) * f;
        p.vx -= fx;
        p.vy -= fy;
        q.vx += fx;
        q.vy += fy;
      }
    }

    for (const l of this.links) {
      const dx = l.t.x - l.s.x;
      const dy = l.t.y - l.s.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const rest = l.ghost ? linkDistance * 1.7 : linkDistance;
      const k = (l.ghost ? linkStrength * 0.15 : linkStrength) * a;
      const f = ((d - rest) / d) * k;
      l.s.vx += dx * f;
      l.s.vy += dy * f;
      l.t.vx -= dx * f;
      l.t.vy -= dy * f;
    }

    for (const p of ns) {
      if (p.fx !== null && p.fy !== null) {
        p.x = p.fx;
        p.y = p.fy;
        p.vx = 0;
        p.vy = 0;
        continue;
      }
      p.vx *= 1 - VELOCITY_DECAY;
      p.vy *= 1 - VELOCITY_DECAY;
      // Guard against runaway forces.
      p.vx = Math.max(-60, Math.min(60, p.vx));
      p.vy = Math.max(-60, Math.min(60, p.vy));
      p.x += p.vx;
      p.y += p.vy;
    }

    this.alpha -= this.alpha * ALPHA_DECAY;
  }

  /** Run until cooled (used by tests / precomputation). */
  public settle(maxTicks = 400): number {
    let t = 0;
    while (this.active && t < maxTicks) {
      this.tick();
      t++;
    }
    return t;
  }

  public bounds(): { minX: number; minY: number; maxX: number; maxY: number } {
    if (this.nodes.length === 0)
      return { minX: -1, minY: -1, maxX: 1, maxY: 1 };
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const n of this.nodes) {
      minX = Math.min(minX, n.x - n.r);
      minY = Math.min(minY, n.y - n.r);
      maxX = Math.max(maxX, n.x + n.r);
      maxY = Math.max(maxY, n.y + n.r);
    }
    return { minX, minY, maxX, maxY };
  }
}

/** Distance from point to segment, for edge hit-testing. */
export function distToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
