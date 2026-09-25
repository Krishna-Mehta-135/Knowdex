"use client";

import { useCallback, useEffect, useState } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import * as Y from "yjs";
import { yXmlFragmentToProsemirrorJSON } from "@tiptap/y-tiptap";
import { toast } from "sonner";
import { History, RotateCcw, Save, X } from "lucide-react";
import { kx } from "@/lib/kx/api";
import { createContentExtensions } from "./extensions/contentExtensions";

interface VersionRow {
  id: string;
  createdAt: string;
  wordCount: number;
  preview: string;
  kind: "auto" | "manual";
}

type Json = Record<string, unknown>;

function decodeState(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Turn a stored Y state into ProseMirror JSON. */
function stateToJson(state: Uint8Array): Json {
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, state);
    return yXmlFragmentToProsemirrorJSON(doc.getXmlFragment("content")) as Json;
  } finally {
    doc.destroy();
  }
}

const fmt = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/** Time-travel: browse past versions of a note, preview them, restore one non-destructively. */
export function VersionHistory({
  docId,
  editor,
  onClose,
}: {
  docId: string;
  editor: Editor | null;
  onClose: () => void;
}) {
  const [versions, setVersions] = useState<VersionRow[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [json, setJson] = useState<Json | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preview = useEditor(
    {
      extensions: createContentExtensions(),
      editable: false,
      immediatelyRender: false,
      editorProps: {
        attributes: {
          class:
            "prose prose-invert prose-sm max-w-none text-[13px] leading-relaxed",
        },
      },
    },
    [],
  );

  const loadList = useCallback(async () => {
    try {
      setVersions(await kx<VersionRow[]>(`documents/${docId}/versions`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load history");
    }
  }, [docId]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    setJson(null);
    kx<{ state: string }>(`documents/${docId}/versions/${selected}`)
      .then((v) => !cancelled && setJson(stateToJson(decodeState(v.state))))
      .catch(
        (e) =>
          !cancelled &&
          setError(e instanceof Error ? e.message : "Could not load version"),
      );
    return () => {
      cancelled = true;
    };
  }, [selected, docId]);

  useEffect(() => {
    if (!preview || !json) return;
    // Node views flushSync; doing that inside an effect warns, so defer a tick.
    queueMicrotask(() => {
      if (!preview.isDestroyed) preview.commands.setContent(json as never);
    });
  }, [preview, json]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const saveCheckpoint = async () => {
    setBusy(true);
    try {
      await kx(`documents/${docId}/versions`, { method: "POST" });
      toast.success("Version saved");
      await loadList();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save version");
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    if (!editor || !json) return;
    setBusy(true);
    try {
      // Keep what's there now so the restore itself can be undone.
      await kx(`documents/${docId}/versions`, { method: "POST" }).catch(
        () => undefined,
      );
      editor.commands.setContent(json as never, { emitUpdate: true });
      toast.success("Restored — the previous text is saved in history");
      await loadList();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-end"
      role="dialog"
      aria-modal="true"
      aria-label="Version history"
    >
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative flex w-full max-w-3xl flex-col border-l border-[hsl(var(--sb-border))] bg-[hsl(var(--sb-bg-panel))] shadow-2xl md:flex-row">
        <div className="flex max-h-[45vh] w-full shrink-0 flex-col border-b border-[hsl(var(--sb-border))] md:max-h-none md:w-64 md:border-b-0 md:border-r">
          <div className="flex items-center gap-2 px-4 py-3 text-sm font-medium">
            <History size={15} className="text-[hsl(var(--sb-accent))]" />{" "}
            History
            <button
              onClick={onClose}
              aria-label="Close history"
              className="ml-auto rounded p-1 hover:bg-[hsl(var(--sb-bg-hover))] md:hidden"
            >
              <X size={15} />
            </button>
          </div>
          <div className="px-3 pb-2">
            <button
              onClick={() => void saveCheckpoint()}
              disabled={busy}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-[hsl(var(--sb-border-hover))] px-3 py-1.5 text-xs hover:bg-[hsl(var(--sb-bg-hover))] disabled:opacity-50"
            >
              <Save size={13} /> Save version now
            </button>
          </div>
          <ul className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-3 custom-scrollbar">
            {versions === null && !error && (
              <li className="p-3 text-xs text-[hsl(var(--sb-text-faint))]">
                Loading…
              </li>
            )}
            {versions?.length === 0 && (
              <li className="p-3 text-xs leading-relaxed text-[hsl(var(--sb-text-faint))]">
                No versions yet. Snapshots are taken automatically a few minutes
                after you edit, or save one now.
              </li>
            )}
            {versions?.map((v) => (
              <li key={v.id}>
                <button
                  onClick={() => setSelected(v.id)}
                  aria-pressed={selected === v.id}
                  className={`w-full rounded-lg px-3 py-2 text-left text-xs transition-colors hover:bg-[hsl(var(--sb-bg-hover))] ${selected === v.id ? "bg-[hsl(var(--sb-accent))]/15" : ""}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">
                      {fmt.format(new Date(v.createdAt))}
                    </span>
                    {v.kind === "manual" && (
                      <span className="rounded bg-[hsl(var(--sb-accent))]/20 px-1.5 text-[10px] text-[hsl(var(--sb-accent))]">
                        saved
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 line-clamp-2 text-[hsl(var(--sb-text-muted))]">
                    {v.preview || "(empty)"}
                  </div>
                  <div className="mt-0.5 text-[10px] text-[hsl(var(--sb-text-faint))]">
                    {v.wordCount} words
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="hidden items-center justify-between px-4 py-3 md:flex">
            <span className="text-sm text-[hsl(var(--sb-text-muted))]">
              {selected ? "Preview" : "Select a version"}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => void restore()}
                disabled={!json || busy || !editor}
                className="flex items-center gap-1.5 rounded-lg bg-[hsl(var(--sb-accent))] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
              >
                <RotateCcw size={13} /> Restore this version
              </button>
              <button
                onClick={onClose}
                aria-label="Close history"
                className="rounded p-1.5 hover:bg-[hsl(var(--sb-bg-hover))]"
              >
                <X size={16} />
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto px-6 py-4 custom-scrollbar">
            {error && <p className="text-sm text-red-300">{error}</p>}
            {selected && !json && !error && (
              <p className="text-sm text-[hsl(var(--sb-text-faint))]">
                Loading version…
              </p>
            )}
            {json && <EditorContent editor={preview} />}
          </div>
          {selected && (
            <div className="border-t border-[hsl(var(--sb-border))] p-3 md:hidden">
              <button
                onClick={() => void restore()}
                disabled={!json || busy || !editor}
                className="w-full rounded-lg bg-[hsl(var(--sb-accent))] px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
              >
                Restore this version
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
