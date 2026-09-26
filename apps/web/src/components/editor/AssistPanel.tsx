"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { toast } from "sonner";
import {
  Check,
  Copy,
  ListChecks,
  Loader2,
  PenLine,
  Sparkles,
  Square,
  Tags,
  Wand2,
  X,
} from "lucide-react";
import { kx, streamSSE, type OrganizeResult } from "@/lib/kx/api";
import { useDocuments } from "@/lib/documents/useDocuments";
import { linkifyWikiText } from "@/lib/editor/linkifyWiki";

type Action =
  | "summarize"
  | "action-items"
  | "continue"
  | "improve"
  | "explain"
  | "custom";

const ACTIONS: {
  id: Exclude<Action, "custom">;
  label: string;
  icon: typeof Sparkles;
  needsSelection?: boolean;
}[] = [
  { id: "summarize", label: "Summarize", icon: Sparkles },
  { id: "action-items", label: "Extract action items", icon: ListChecks },
  { id: "continue", label: "Continue writing", icon: PenLine },
  {
    id: "improve",
    label: "Improve selection",
    icon: Wand2,
    needsSelection: true,
  },
  { id: "explain", label: "Explain (selection or note)", icon: Sparkles },
];

interface Range {
  from: number;
  to: number;
  text: string;
}

/** Side panel: AI actions on the open note + tag/link suggestions. */
export function AssistPanel({
  docId,
  editor,
  onClose,
}: {
  docId: string;
  editor: Editor | null;
  onClose: () => void;
}) {
  const { documents, updateDocument } = useDocuments();
  const [selection, setSelection] = useState<Range | null>(null);
  const [output, setOutput] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [custom, setCustom] = useState("");
  const [org, setOrg] = useState<OrganizeResult | null>(null);
  const [orgBusy, setOrgBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const captured = useRef<Range | null>(null);

  // Track the user's selection so "Improve" knows what to rewrite.
  useEffect(() => {
    if (!editor) return;
    const read = () => {
      const { from, to } = editor.state.selection;
      setSelection(
        from === to
          ? null
          : { from, to, text: editor.state.doc.textBetween(from, to, "\n") },
      );
    };
    read();
    editor.on("selectionUpdate", read);
    return () => void editor.off("selectionUpdate", read);
  }, [editor]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const run = useCallback(
    async (action: Action, instruction?: string) => {
      abortRef.current?.abort();
      const ctl = new AbortController();
      abortRef.current = ctl;
      captured.current = selection;
      setOutput("");
      setError(null);
      setRunning(true);
      try {
        await streamSSE(
          `documents/${docId}/assist`,
          { action, instruction, selection: selection?.text },
          (ev, data) => {
            if (ev === "token") setOutput((o) => o + String(data.text ?? ""));
            else if (ev === "error")
              setError(String(data.message ?? "Something went wrong"));
          },
          ctl.signal,
        );
      } catch (e) {
        if ((e as Error).name !== "AbortError")
          setError("Connection lost. Try again.");
      } finally {
        setRunning(false);
      }
    },
    [docId, selection],
  );

  const insert = (mode: "cursor" | "replace") => {
    if (!editor || !output.trim()) return;
    const chain = editor.chain().focus();
    const cap = captured.current;
    const opts = { parseOptions: { preserveWhitespace: false as const } };
    if (mode === "replace" && cap) {
      const unchanged =
        editor.state.doc.textBetween(
          cap.from,
          Math.min(cap.to, editor.state.doc.content.size),
          "\n",
        ) === cap.text;
      if (unchanged)
        chain
          .deleteRange({ from: cap.from, to: cap.to })
          .insertContentAt(cap.from, output, opts)
          .run();
      else {
        toast.error(
          "The selection changed, so the result was inserted at the cursor.",
        );
        chain.insertContent(output, opts).run();
      }
    } else {
      chain.insertContent(output, opts).run();
    }
    linkifyWikiText(editor);
    setOutput("");
  };

  const suggest = async () => {
    setOrgBusy(true);
    try {
      setOrg(
        await kx<OrganizeResult>(`documents/${docId}/organize`, {
          method: "POST",
        }),
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not get suggestions");
    } finally {
      setOrgBusy(false);
    }
  };

  const currentTags = documents.find((d) => d.id === docId)?.tags ?? [];
  const addTag = async (tag: string) => {
    const ok = await updateDocument(docId, {
      tags: [...new Set([...currentTags, tag])],
    });
    if (ok)
      setOrg((o) => (o ? { ...o, tags: o.tags.filter((t) => t !== tag) } : o));
    else toast.error("Could not add tag");
  };

  const btn =
    "flex w-full items-center gap-2 rounded-lg border border-[hsl(var(--sb-border))] px-3 py-2 text-left text-sm hover:bg-[hsl(var(--sb-bg-hover))] disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <aside
      aria-label="AI assistant"
      className="fixed inset-y-0 right-0 z-40 flex w-full max-w-sm flex-col border-l border-[hsl(var(--sb-border))] bg-[hsl(var(--sb-bg-panel))] shadow-2xl"
    >
      <div className="flex items-center gap-2 border-b border-[hsl(var(--sb-border))] px-4 py-3 text-sm font-medium">
        <Sparkles size={15} className="text-[hsl(var(--sb-accent))]" />{" "}
        Assistant
        <button
          onClick={onClose}
          aria-label="Close assistant"
          className="ml-auto rounded p-1 hover:bg-[hsl(var(--sb-bg-hover))]"
        >
          <X size={15} />
        </button>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto p-4 custom-scrollbar">
        <section className="space-y-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--sb-text-faint))]">
            Do something with this note
          </h3>
          {ACTIONS.map((a) => (
            <button
              key={a.id}
              disabled={running || (a.needsSelection && !selection)}
              onClick={() => void run(a.id)}
              className={btn}
            >
              <a.icon size={14} className="text-[hsl(var(--sb-accent))]" />{" "}
              {a.label}
              {a.needsSelection && !selection && (
                <span className="ml-auto text-[10px] text-[hsl(var(--sb-text-faint))]">
                  select text first
                </span>
              )}
            </button>
          ))}
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (custom.trim()) void run("custom", custom.trim());
            }}
          >
            <input
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              maxLength={1000}
              placeholder="Or ask anything about this note…"
              aria-label="Custom instruction"
              className="min-w-0 flex-1 rounded-lg border border-[hsl(var(--sb-border-hover))] bg-transparent px-3 py-2 text-sm outline-none focus:border-[hsl(var(--sb-accent))]"
            />
            <button
              disabled={running || !custom.trim()}
              className="rounded-lg bg-[hsl(var(--sb-accent))] px-3 text-sm font-medium text-white disabled:opacity-40"
            >
              Go
            </button>
          </form>
        </section>

        {(running || output || error) && (
          <section
            aria-live="polite"
            className="rounded-xl border border-fuchsia-400/30 bg-fuchsia-400/5 p-3"
          >
            {running && !output && (
              <p className="flex items-center gap-2 text-xs text-[hsl(var(--sb-text-muted))]">
                <Loader2 size={12} className="animate-spin" /> Thinking…
              </p>
            )}
            {output && (
              <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap font-sans text-sm">
                {output}
              </pre>
            )}
            {error && <p className="text-sm text-red-300">{error}</p>}
            {running ? (
              <button
                onClick={() => abortRef.current?.abort()}
                className="mt-2 flex items-center gap-1 text-xs text-[hsl(var(--sb-text-muted))] hover:text-white"
              >
                <Square size={11} /> Stop
              </button>
            ) : (
              output && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    onClick={() => insert("cursor")}
                    className="flex items-center gap-1 rounded-lg bg-fuchsia-500/80 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-fuchsia-500"
                  >
                    <Check size={12} /> Insert at cursor
                  </button>
                  {captured.current && (
                    <button
                      onClick={() => insert("replace")}
                      className="rounded-lg border border-[hsl(var(--sb-border-hover))] px-2.5 py-1.5 text-xs hover:bg-[hsl(var(--sb-bg-hover))]"
                    >
                      Replace selection
                    </button>
                  )}
                  <button
                    onClick={() =>
                      void navigator.clipboard
                        .writeText(output)
                        .then(() => toast.success("Copied"))
                    }
                    className="flex items-center gap-1 rounded-lg border border-[hsl(var(--sb-border-hover))] px-2.5 py-1.5 text-xs hover:bg-[hsl(var(--sb-bg-hover))]"
                  >
                    <Copy size={12} /> Copy
                  </button>
                  <button
                    onClick={() => setOutput("")}
                    className="rounded-lg px-2.5 py-1.5 text-xs text-[hsl(var(--sb-text-muted))] hover:text-white"
                  >
                    Discard
                  </button>
                </div>
              )
            )}
          </section>
        )}

        <section className="space-y-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--sb-text-faint))]">
            Organize
          </h3>
          <button
            onClick={() => void suggest()}
            disabled={orgBusy}
            className={btn}
          >
            {orgBusy ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Tags size={14} className="text-[hsl(var(--sb-accent))]" />
            )}{" "}
            Suggest tags & links
          </button>
          {org && (
            <div className="space-y-3 text-sm">
              {org.tags.length === 0 && org.links.length === 0 && (
                <p className="text-xs text-[hsl(var(--sb-text-faint))]">
                  Nothing to suggest — this note is already well organized.
                </p>
              )}
              {org.tags.length > 0 && (
                <div>
                  <p className="mb-1 text-xs text-[hsl(var(--sb-text-muted))]">
                    Tags{org.source === "keywords" ? " (from keywords)" : ""}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {org.tags.map((t) => (
                      <button
                        key={t}
                        onClick={() => void addTag(t)}
                        title="Add tag"
                        className="rounded-full border border-[hsl(var(--sb-border-hover))] px-2.5 py-1 text-xs hover:bg-[hsl(var(--sb-accent))]/20"
                      >
                        + {t}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {org.links.length > 0 && (
                <div>
                  <p className="mb-1 text-xs text-[hsl(var(--sb-text-muted))]">
                    Related notes to link
                  </p>
                  <ul className="space-y-1">
                    {org.links.map((l) => (
                      <li key={l.id} className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate">
                          {l.title}
                        </span>
                        <button
                          onClick={() => {
                            window.dispatchEvent(
                              new CustomEvent("knowdex:insert-wikilink", {
                                detail: { title: l.title },
                              }),
                            );
                            setOrg((o) =>
                              o
                                ? {
                                    ...o,
                                    links: o.links.filter((x) => x.id !== l.id),
                                  }
                                : o,
                            );
                          }}
                          className="rounded-md border border-[hsl(var(--sb-border-hover))] px-2 py-1 text-xs hover:bg-[hsl(var(--sb-bg-hover))]"
                        >
                          Link
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </aside>
  );
}
