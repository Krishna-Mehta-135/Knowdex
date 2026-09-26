"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FileText, Loader2, Send, Sparkles, Square } from "lucide-react";
import { useWorkspace } from "@/lib/workspaces/WorkspaceProvider";
import { askWorkspace, type AskSource } from "@/lib/kx/api";
import { parseAnswer, type Inline } from "@/lib/ask/answerBlocks";
import { useTypewriter } from "@/lib/ui/typewriter";

interface Turn {
  id: number;
  question: string;
  answer: string;
  sources: AskSource[];
  status: "streaming" | "done" | "error";
  mode?: string;
  error?: string;
  /** Stream ended early; the text above is partial. */
  interrupted?: boolean;
}

function Inlines({
  inline,
  sources,
}: {
  inline: Inline[];
  sources: AskSource[];
}) {
  return (
    <>
      {inline.map((x, i) => {
        if (x.t === "bold")
          return (
            <strong key={i} className="font-semibold text-white">
              {x.v}
            </strong>
          );
        if (x.t === "code")
          return (
            <code
              key={i}
              className="rounded bg-white/10 px-1 py-0.5 text-[12px]"
            >
              {x.v}
            </code>
          );
        if (x.t === "cite") {
          const src = sources.find((s) => s.n === x.n);
          if (!src) return <span key={i}>[{x.n}]</span>;
          return (
            <Link
              key={i}
              href={`/documents/${src.sourceId}`}
              title={src.title}
              className="mx-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded bg-[hsl(var(--sb-accent))]/25 px-1 align-baseline text-[10px] font-semibold text-[hsl(var(--sb-accent))] no-underline hover:bg-[hsl(var(--sb-accent))]/40"
            >
              {src.n}
            </Link>
          );
        }
        return <span key={i}>{x.v}</span>;
      })}
    </>
  );
}

/** Answer body: light Markdown with clickable citation chips. */
function Answer({
  text,
  sources,
  streaming,
}: {
  text: string;
  sources: AskSource[];
  streaming: boolean;
}) {
  // Reveal word by word, even when the model delivers large chunks.
  const { shown, typing } = useTypewriter(text);
  const blocks = parseAnswer(shown);
  const caret = streaming || typing;
  return (
    <div className="space-y-2.5 text-sm leading-relaxed text-[hsl(var(--sb-text))]">
      {blocks.map((b, i) => {
        if (b.t === "p")
          return (
            <p key={i}>
              <Inlines inline={b.inline} sources={sources} />
            </p>
          );
        if (b.t === "h")
          return (
            <p key={i} className="font-semibold text-white">
              <Inlines inline={b.inline} sources={sources} />
            </p>
          );
        const List = b.t === "ul" ? "ul" : "ol";
        return (
          <List
            key={i}
            className={`space-y-1 pl-5 ${b.t === "ul" ? "list-disc" : "list-decimal"} marker:text-[hsl(var(--sb-accent))]`}
          >
            {b.items.map((it, j) => (
              <li key={j}>
                <Inlines inline={it} sources={sources} />
              </li>
            ))}
          </List>
        );
      })}
      {caret && (
        <span
          aria-hidden
          className="inline-block h-4 w-[2px] translate-y-0.5 animate-pulse bg-[hsl(var(--sb-accent))]"
        />
      )}
    </div>
  );
}

export function AskView() {
  const { activeWorkspaceId } = useWorkspace();
  const params = useSearchParams();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const idRef = useRef(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const autoAsked = useRef<string | null>(null);

  const busy = turns.at(-1)?.status === "streaming";

  const ask = useCallback(
    async (question: string) => {
      const q = question.trim();
      if (!q || !activeWorkspaceId) return;
      const id = ++idRef.current;
      setTurns((t) => [
        ...t,
        { id, question: q, answer: "", sources: [], status: "streaming" },
      ]);
      setInput("");
      const ctl = new AbortController();
      abortRef.current = ctl;
      const patch = (fn: (t: Turn) => Turn) =>
        setTurns((all) => all.map((t) => (t.id === id ? fn(t) : t)));
      try {
        await askWorkspace(
          activeWorkspaceId,
          q,
          {
            onSources: (sources) => patch((t) => ({ ...t, sources })),
            onToken: (tok) => patch((t) => ({ ...t, answer: t.answer + tok })),
            onDone: (mode) => patch((t) => ({ ...t, status: "done", mode })),
            onError: (error) =>
              patch((t) => ({ ...t, status: "error", error })),
          },
          ctl.signal,
        );
        // The stream closed without a `done` event: the connection was cut
        // (timeout, network). Say so instead of leaving an endless spinner.
        patch((t) =>
          t.status !== "streaming"
            ? t
            : t.answer.trim()
              ? { ...t, status: "done", interrupted: true }
              : {
                  ...t,
                  status: "error",
                  error: "The answer was interrupted. Please try again.",
                },
        );
      } catch (e) {
        if ((e as Error).name === "AbortError")
          patch((t) => ({ ...t, status: "done" }));
        else
          patch((t) => ({
            ...t,
            status: "error",
            error: (e as Error).message,
          }));
      }
    },
    [activeWorkspaceId],
  );

  // /ask?q=… (from the command palette) asks immediately, once per query.
  useEffect(() => {
    const q = params.get("q");
    if (q && activeWorkspaceId && autoAsked.current !== q) {
      autoAsked.current = q;
      void ask(q);
    }
  }, [params, activeWorkspaceId, ask]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns]);

  useEffect(() => () => abortRef.current?.abort(), []);

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col px-4">
      <div className="flex-1 space-y-8 overflow-y-auto py-8 custom-scrollbar">
        {turns.length === 0 && (
          <div className="mt-16 text-center">
            <Sparkles
              className="mx-auto mb-3 text-[hsl(var(--sb-accent))]"
              size={28}
            />
            <h2 className="text-lg font-medium">Ask your notes anything</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-[hsl(var(--sb-text-muted))]">
              Answers are grounded in this workspace’s notes and PDFs, with
              numbered citations you can click.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              {[
                "Summarize what I know about my main topics",
                "Which notes are related to each other?",
                "What action items do I have?",
              ].map((s) => (
                <button
                  key={s}
                  onClick={() => void ask(s)}
                  className="rounded-full border border-[hsl(var(--sb-border))] px-3 py-1.5 text-xs text-[hsl(var(--sb-text-muted))] hover:bg-[hsl(var(--sb-bg-hover))]"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {turns.map((t) => (
          <div key={t.id} className="space-y-3">
            <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-[hsl(var(--sb-accent))]/20 px-4 py-2 text-sm">
              {t.question}
            </div>
            <div className="rounded-2xl rounded-bl-sm border border-[hsl(var(--sb-border))] bg-[hsl(var(--sb-bg-panel))] px-4 py-3">
              {t.status === "streaming" && !t.answer && (
                <div className="flex items-center gap-2 text-sm text-[hsl(var(--sb-text-muted))]">
                  <Loader2 size={14} className="animate-spin" /> Searching your
                  notes…
                </div>
              )}
              {t.answer && (
                <Answer
                  text={t.answer}
                  sources={t.sources}
                  streaming={t.status === "streaming"}
                />
              )}
              {t.interrupted && (
                <p className="mt-2 text-[11px] text-amber-300">
                  The connection dropped before the answer finished.
                </p>
              )}
              {t.status === "error" && (
                <p className="text-sm text-red-300">
                  Something went wrong: {t.error}
                </p>
              )}
              {t.status === "done" &&
                t.mode === "extractive" &&
                t.sources.length > 0 && (
                  <p className="mt-2 text-[11px] text-[hsl(var(--sb-text-faint))]">
                    AI generation unavailable — showing matching passages.
                  </p>
                )}
              {t.sources.length > 0 && (
                <ul className="mt-3 flex flex-wrap gap-2 border-t border-[hsl(var(--sb-border))] pt-3">
                  {t.sources.map((s) => (
                    <li key={s.n}>
                      <Link
                        href={`/documents/${s.sourceId}`}
                        title={s.snippet}
                        className="flex max-w-[220px] items-center gap-1.5 rounded-lg border border-[hsl(var(--sb-border))] px-2 py-1 text-xs text-[hsl(var(--sb-text-muted))] no-underline hover:bg-[hsl(var(--sb-bg-hover))]"
                      >
                        <span className="font-semibold text-[hsl(var(--sb-accent))]">
                          {s.n}
                        </span>
                        <FileText size={12} />
                        <span className="truncate">{s.title}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy) void ask(input);
        }}
        className="mb-4 flex items-center gap-2 rounded-2xl border border-[hsl(var(--sb-border))] bg-[hsl(var(--sb-bg-panel))] px-4 py-2 focus-within:border-[hsl(var(--sb-accent))]/60"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask a question about your notes…"
          aria-label="Question"
          maxLength={1000}
          className="flex-1 bg-transparent py-2 text-sm outline-none placeholder:text-[hsl(var(--sb-text-faint))]"
        />
        {busy ? (
          <button
            type="button"
            onClick={() => abortRef.current?.abort()}
            aria-label="Stop"
            className="rounded-lg p-2 hover:bg-[hsl(var(--sb-bg-hover))]"
          >
            <Square size={16} />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!input.trim() || !activeWorkspaceId}
            aria-label="Send"
            className="rounded-lg p-2 text-[hsl(var(--sb-accent))] hover:bg-[hsl(var(--sb-bg-hover))] disabled:opacity-40"
          >
            <Send size={16} />
          </button>
        )}
      </form>
    </div>
  );
}
