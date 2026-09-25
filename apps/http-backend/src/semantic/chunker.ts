export interface ChunkOptions {
  /** Target max characters per chunk. */
  size?: number;
  /** Characters carried over from the previous chunk for context. */
  overlap?: number;
}

/**
 * Split text into paragraph-aligned chunks. Long paragraphs are split on
 * sentence boundaries, and finally hard-split, so no chunk exceeds `size`.
 */
export function chunkText(text: string, opts: ChunkOptions = {}): string[] {
  const size = opts.size ?? 900;
  const overlap = Math.min(opts.overlap ?? 120, Math.floor(size / 3));
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (!clean) return [];

  const pieces: string[] = [];
  for (const para of clean.split(/\n{2,}|\n(?=#{1,6}\s)/)) {
    const p = para.trim();
    if (!p) continue;
    if (p.length <= size) {
      pieces.push(p);
      continue;
    }
    const sentences = p.split(/(?<=[.!?])\s+/);
    let buf = "";
    for (const s of sentences) {
      if (s.length > size) {
        if (buf) pieces.push(buf);
        buf = "";
        for (let i = 0; i < s.length; i += size)
          pieces.push(s.slice(i, i + size));
        continue;
      }
      if ((buf + " " + s).trim().length > size) {
        pieces.push(buf);
        buf = s;
      } else {
        buf = (buf + " " + s).trim();
      }
    }
    if (buf) pieces.push(buf);
  }

  const chunks: string[] = [];
  let cur = "";
  for (const piece of pieces) {
    if (!cur) {
      cur = piece;
    } else if (cur.length + 2 + piece.length <= size) {
      cur += "\n\n" + piece;
    } else {
      chunks.push(cur);
      const tail = overlap > 0 ? cur.slice(-overlap) : "";
      const merged = tail ? `${tail}\n\n${piece}` : piece;
      cur = merged.length <= size ? merged : piece;
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}
