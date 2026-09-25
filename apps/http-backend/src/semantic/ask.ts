import { GoogleGenerativeAI } from "@google/generative-ai";
import { prisma } from "@repo/db";
import { searchChunks, type ScoredChunk } from "./search.js";

export interface AskSource {
  n: number;
  sourceId: string;
  sourceType: string;
  title: string;
  snippet: string;
  score: number;
}

const MIN_SCORE = 0.05;

export async function retrieveSources(
  workspaceId: string,
  question: string,
): Promise<{ sources: AskSource[]; chunks: ScoredChunk[] }> {
  const raw = (await searchChunks(workspaceId, question, 10)).filter(
    (c) => c.score >= MIN_SCORE,
  );
  // Keep at most 2 chunks per source so one long note can't crowd out the rest.
  const perSource = new Map<string, number>();
  const chunks: ScoredChunk[] = [];
  for (const c of raw) {
    const n = perSource.get(c.sourceId) ?? 0;
    if (n >= 2) continue;
    perSource.set(c.sourceId, n + 1);
    chunks.push(c);
    if (chunks.length === 6) break;
  }

  const docIds = chunks
    .filter((c) => c.sourceType === "document")
    .map((c) => c.sourceId);
  const attIds = chunks
    .filter((c) => c.sourceType === "attachment")
    .map((c) => c.sourceId);
  const [contents, atts] = await Promise.all([
    prisma.content.findMany({
      where: { id: { in: docIds } },
      select: { id: true, title: true },
    }),
    prisma.attachment.findMany({
      where: { id: { in: attIds } },
      select: { id: true, name: true, docId: true },
    }),
  ]);
  const titleOf = new Map<string, string>([
    ...contents.map((c) => [c.id, c.title] as [string, string]),
    ...atts.map((a) => [a.id, a.name] as [string, string]),
  ]);

  const sources: AskSource[] = chunks.map((c, i) => ({
    n: i + 1,
    sourceId: c.sourceId,
    sourceType: c.sourceType,
    title: titleOf.get(c.sourceId) ?? "Untitled",
    snippet: c.text.length > 240 ? c.text.slice(0, 237) + "…" : c.text,
    score: Math.round(c.score * 1000) / 1000,
  }));
  return { sources, chunks };
}

export function buildPrompt(
  question: string,
  sources: AskSource[],
  chunks: ScoredChunk[],
) {
  const context = chunks
    .map((c, i) => `[${sources[i]!.n}] (${sources[i]!.title})\n${c.text}`)
    .join("\n\n---\n\n");
  return [
    "Answer the question using ONLY the notes below. Cite sources inline as [1], [2] matching the note numbers.",
    "If the notes do not contain the answer, say so plainly. Be concise. Use Markdown.",
    "",
    "NOTES:",
    context,
    "",
    `QUESTION: ${question}`,
  ].join("\n");
}

/** Streams answer text. Falls back to an extractive answer when Gemini is unavailable. */
export async function* streamAnswer(
  question: string,
  sources: AskSource[],
  chunks: ScoredChunk[],
  signal?: AbortSignal,
): AsyncGenerator<{ token: string; mode: "gemini" | "extractive" }> {
  if (chunks.length === 0) {
    yield {
      token: "I couldn't find anything relevant in this workspace's notes.",
      mode: "extractive",
    };
    return;
  }
  const key = process.env.GEMINI_API_KEY;
  if (key) {
    try {
      const model = new GoogleGenerativeAI(key).getGenerativeModel({
        model: "gemini-2.5-flash",
      });
      const result = await model.generateContentStream(
        buildPrompt(question, sources, chunks),
        signal ? { signal } : undefined,
      );
      let any = false;
      for await (const part of result.stream) {
        const t = part.text();
        if (t) {
          any = true;
          yield { token: t, mode: "gemini" };
        }
      }
      if (any) return;
    } catch (e) {
      if (signal?.aborted) return;
      console.warn(
        "[ask] gemini failed, using extractive answer:",
        (e as Error).message,
      );
    }
  }
  yield {
    token:
      "AI generation is unavailable, so here are the most relevant passages from your notes:\n\n",
    mode: "extractive",
  };
  for (const s of sources.slice(0, 4)) {
    yield {
      token: `- **${s.title}** [${s.n}]: ${s.snippet.replace(/\n+/g, " ")}\n`,
      mode: "extractive",
    };
  }
}
