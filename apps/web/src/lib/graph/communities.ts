/**
 * Community detection by greedy modularity optimisation (the local-moving phase
 * of Louvain). Deterministic: nodes are visited in sorted order. Unlike plain
 * label propagation it does not flood across a single bridge edge, so dense
 * topic clusters stay separate. O(E) per pass.
 */
export function detectCommunities(
  nodeIds: string[],
  edges: { a: string; b: string }[],
  maxPasses = 20,
): Map<string, number> {
  const ids = [...nodeIds].sort();
  const idx = new Map(ids.map((id, i) => [id, i]));
  const n = ids.length;

  // Deduplicated, undirected adjacency without self loops.
  const adjSet: Set<number>[] = Array.from(
    { length: n },
    () => new Set<number>(),
  );
  for (const e of edges) {
    const a = idx.get(e.a);
    const b = idx.get(e.b);
    if (a === undefined || b === undefined || a === b) continue;
    adjSet[a]!.add(b);
    adjSet[b]!.add(a);
  }
  const adj = adjSet.map((s) => [...s].sort((x, y) => x - y));
  const deg = adj.map((l) => l.length);
  const twoM = deg.reduce((x, y) => x + y, 0);

  const comm = Array.from({ length: n }, (_, i) => i);
  const tot = [...deg]; // total degree per community
  if (twoM > 0) {
    for (let pass = 0; pass < maxPasses; pass++) {
      let moved = false;
      for (let i = 0; i < n; i++) {
        if (deg[i] === 0) continue;
        const own = comm[i]!;
        tot[own]! -= deg[i]!; // take i out of its community
        const links = new Map<number, number>();
        for (const j of adj[i]!)
          links.set(comm[j]!, (links.get(comm[j]!) ?? 0) + 1);
        const gain = (c: number) =>
          (links.get(c) ?? 0) - (tot[c]! * deg[i]!) / twoM;
        let best = own;
        let bestGain = gain(own);
        for (const c of [...links.keys()].sort((x, y) => x - y)) {
          const g = gain(c);
          if (g > bestGain + 1e-12) {
            best = c;
            bestGain = g;
          }
        }
        tot[best]! += deg[i]!;
        if (best !== own) {
          comm[i] = best;
          moved = true;
        }
      }
      if (!moved) break;
    }
  }

  // Re-index communities by size (largest = 0); singletons get -1 (uncoloured).
  const sizes = new Map<number, number>();
  for (const c of comm) sizes.set(c, (sizes.get(c) ?? 0) + 1);
  const order = [...sizes]
    .filter(([, sz]) => sz >= 2)
    .sort((x, y) => y[1] - x[1] || x[0] - y[0])
    .map(([c]) => c);
  const index = new Map(order.map((c, i) => [c, i]));
  return new Map(ids.map((id, i) => [id, index.get(comm[i]!) ?? -1]));
}

/** Theme-matched hues (indigo/violet family first, then complementary accents). */
export const CLUSTER_PALETTE = [
  "#818cf8",
  "#e879f9",
  "#38bdf8",
  "#34d399",
  "#fbbf24",
  "#fb7185",
  "#2dd4bf",
  "#a78bfa",
];

export function paletteColor(i: number): string {
  return CLUSTER_PALETTE[i % CLUSTER_PALETTE.length]!;
}

/** Stable colour index for a string (used for tags). */
export function hashIndex(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++)
    h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) % CLUSTER_PALETTE.length;
}
