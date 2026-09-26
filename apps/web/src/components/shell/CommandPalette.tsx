"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  FileText,
  Globe,
  MessageSquareText,
  Network,
  Plus,
  Search,
  Sparkles,
  Table2,
  Upload,
} from "lucide-react";
import { useDocuments } from "@/lib/documents/useDocuments";
import { useWorkspace } from "@/lib/workspaces/WorkspaceProvider";
import { kx, type SearchHit } from "@/lib/kx/api";

interface Item {
  key: string;
  section: string;
  label: string;
  hint?: string;
  icon: React.ReactNode;
  run: () => void;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onCreateNew: () => void;
}

export function CommandPalette({ open, onClose, onCreateNew }: Props) {
  const router = useRouter();
  const { documents } = useDocuments();
  const { activeWorkspaceId } = useWorkspace();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [cursor, setCursor] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setHits([]);
      setCursor(0);
    }
  }, [open]);

  // Semantic ("meaning") search, debounced; stale requests are ignored.
  useEffect(() => {
    const q = query.trim();
    if (!open || !activeWorkspaceId || q.length < 3) {
      setHits([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(() => {
      kx<SearchHit[]>(`workspaces/${activeWorkspaceId}/search`, {
        method: "POST",
        json: { query: q },
      })
        .then((r) => !cancelled && setHits(r))
        .catch(() => !cancelled && setHits([]))
        .finally(() => !cancelled && setSearching(false));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, open, activeWorkspaceId]);

  const go = (path: string) => {
    onClose();
    router.push(path);
  };

  const items = useMemo<Item[]>(() => {
    const q = query.trim().toLowerCase();
    const out: Item[] = [];
    const actions: Item[] = [
      {
        key: "new",
        section: "Actions",
        label: "Create new note",
        hint: "⌘N",
        icon: <Plus size={15} />,
        run: () => {
          onClose();
          onCreateNew();
        },
      },
      {
        key: "graph",
        section: "Actions",
        label: "Open knowledge graph",
        icon: <Network size={15} />,
        run: () => go("/graph"),
      },
      {
        key: "ask",
        section: "Actions",
        label: "Ask your notes…",
        icon: <MessageSquareText size={15} />,
        run: () => go("/ask"),
      },
      {
        key: "databases",
        section: "Actions",
        label: "Open databases",
        icon: <Table2 size={15} />,
        run: () => go("/databases"),
      },
      {
        key: "import",
        section: "Actions",
        label: "Import notes (Markdown, Obsidian, Notion)",
        icon: <Upload size={15} />,
        run: () => go("/import"),
      },
      {
        key: "clip",
        section: "Actions",
        label: "Clip a web page",
        icon: <Globe size={15} />,
        run: () => go("/import?tab=clip"),
      },
    ];
    if (q) {
      out.push({
        key: "ask-q",
        section: "Ask",
        label: `Ask: “${query.trim()}”`,
        hint: "AI answer with sources",
        icon: <Sparkles size={15} />,
        run: () => go(`/ask?q=${encodeURIComponent(query.trim())}`),
      });
      const titleMatches = documents
        .filter((d) => (d.title ?? "").toLowerCase().includes(q))
        .slice(0, 6);
      for (const d of titleMatches) {
        out.push({
          key: `t-${d.id}`,
          section: "Notes",
          label: d.title || "Untitled",
          icon: <FileText size={15} />,
          run: () => go(`/documents/${d.id}`),
        });
      }
      const seen = new Set(titleMatches.map((d) => d.id));
      for (const h of hits) {
        if (seen.has(h.id)) continue;
        out.push({
          key: `s-${h.id}`,
          section: "Related by meaning",
          label: h.title,
          hint: h.snippet,
          icon: <Sparkles size={15} />,
          run: () => go(`/documents/${h.id}`),
        });
      }
      out.push(...actions.filter((a) => a.label.toLowerCase().includes(q)));
    } else {
      out.push(...actions);
      for (const d of documents.slice(0, 6)) {
        out.push({
          key: `r-${d.id}`,
          section: "Recent notes",
          label: d.title || "Untitled",
          icon: <FileText size={15} />,
          run: () => go(`/documents/${d.id}`),
        });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, documents, hits]);

  useEffect(() => setCursor(0), [query]);
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-idx="${cursor}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  if (!open) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(items.length - 1, c + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      items[cursor]?.run();
    } else if (e.key === "Escape") {
      onClose();
    }
  };

  let lastSection = "";
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center px-3 pt-[12vh]"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative flex w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-[hsl(var(--sb-border))] bg-[hsl(var(--sb-bg-panel))] shadow-[0_20px_60px_-15px_rgba(0,0,0,0.7),0_0_40px_-10px_hsla(var(--sb-accent-glow)/0.2)]">
        <div className="flex h-14 items-center border-b border-[hsl(var(--sb-border))] px-4">
          <Search size={18} className="text-[hsl(var(--sb-text-muted))]" />
          <input
            autoFocus
            role="combobox"
            aria-expanded="true"
            aria-controls="cmdk-list"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search notes by title or meaning, run a command, or ask a question…"
            className="flex-1 bg-transparent px-3 text-base text-white placeholder:text-[hsl(var(--sb-text-faint))] focus:outline-none"
          />
          {searching && (
            <span className="mr-2 text-[10px] text-[hsl(var(--sb-text-faint))]">
              searching…
            </span>
          )}
          <kbd className="rounded border border-[hsl(var(--sb-border))] bg-[hsl(var(--sb-bg))] px-2 py-1 text-[10px] text-[hsl(var(--sb-text-faint))]">
            ESC
          </kbd>
        </div>
        <ul
          id="cmdk-list"
          ref={listRef}
          role="listbox"
          className="max-h-[55vh] overflow-y-auto p-2"
        >
          {items.map((it, i) => {
            const header = it.section !== lastSection ? it.section : null;
            lastSection = it.section;
            return (
              <li key={it.key} role="presentation">
                {header && (
                  <div className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--sb-text-faint))]">
                    {header}
                  </div>
                )}
                <button
                  role="option"
                  aria-selected={i === cursor}
                  data-idx={i}
                  onMouseMove={() => setCursor(i)}
                  onClick={it.run}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors ${i === cursor ? "bg-[hsl(var(--sb-accent))]/15 text-white" : "text-[hsl(var(--sb-text-muted))]"}`}
                >
                  <span
                    className={
                      i === cursor ? "text-[hsl(var(--sb-accent))]" : ""
                    }
                  >
                    {it.icon}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{it.label}</span>
                  {it.hint && (
                    <span className="max-w-[45%] truncate text-xs text-[hsl(var(--sb-text-faint))]">
                      {it.hint}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
          {items.length === 0 && (
            <li className="px-3 py-6 text-center text-sm text-[hsl(var(--sb-text-faint))]">
              Nothing found
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}
