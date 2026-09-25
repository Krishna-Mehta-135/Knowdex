export function dot(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < n; i++) s += a[i]! * b[i]!;
  return s;
}

export function normalize(v: number[]): number[] {
  let s = 0;
  for (const x of v) s += x * x;
  const n = Math.sqrt(s) || 1;
  return v.map((x) => x / n);
}

/** Cosine similarity (vectors need not be normalised). */
export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let d = 0,
    na = 0,
    nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    d += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  const den = Math.sqrt(na) * Math.sqrt(nb);
  return den === 0 ? 0 : d / den;
}

/** Mean of vectors, L2-normalised. */
export function centroid(vectors: ArrayLike<number>[]): number[] {
  if (vectors.length === 0) return [];
  const dim = vectors[0]!.length;
  const acc = new Array<number>(dim).fill(0);
  for (const v of vectors) for (let i = 0; i < dim; i++) acc[i]! += v[i] ?? 0;
  return normalize(acc);
}
