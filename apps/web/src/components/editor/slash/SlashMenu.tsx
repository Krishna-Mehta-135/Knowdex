"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Globe, Loader2 } from "lucide-react";
import type { SlashState } from "./SlashCommand";

interface Props {
  state: SlashState | null;
  urlPrompt: {
    onSubmit: (url: string) => Promise<void>;
    onCancel: () => void;
  } | null;
  /** Filled by the menu so the editor extension can forward key events. */
  keyHandler: React.MutableRefObject<(e: KeyboardEvent) => boolean>;
}

export function SlashMenu({ state, urlPrompt, keyHandler }: Props) {
  const [index, setIndex] = useState(0);
  const [pos, setPos] = useState<{
    left: number;
    top: number;
    up: boolean;
  } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const items = state?.items ?? [];

  useEffect(() => setIndex(0), [state?.query]);

  useLayoutEffect(() => {
    const r = state?.rect?.();
    if (!r) return;
    const menuH = 320;
    const below = window.innerHeight - r.bottom > menuH;
    setPos({
      left: Math.max(8, Math.min(r.left, window.innerWidth - 300)),
      top: below ? r.bottom + 6 : r.top - 6,
      up: !below,
    });
  }, [state]);

  useEffect(() => {
    keyHandler.current = (e) => {
      if (!state || urlPrompt) return false;
      if (items.length === 0) return false;
      if (e.key === "ArrowDown") {
        setIndex((i) => (i + 1) % items.length);
        return true;
      }
      if (e.key === "ArrowUp") {
        setIndex((i) => (i - 1 + items.length) % items.length);
        return true;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        const it = items[index];
        if (it) state.select(it);
        return true;
      }
      return false;
    };
  });

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-i="${index}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [index]);

  if (urlPrompt) return <UrlPrompt {...urlPrompt} pos={pos} />;
  if (!state || items.length === 0 || !pos) return null;

  let last = "";
  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label="Insert block"
      style={{
        left: pos.left,
        top: pos.top,
        transform: pos.up ? "translateY(-100%)" : undefined,
      }}
      className="fixed z-50 max-h-80 w-72 overflow-y-auto rounded-xl border border-[hsl(var(--sb-border))] bg-[hsl(var(--sb-bg-panel))] p-1.5 shadow-2xl"
      onMouseDown={(e) => e.preventDefault()}
    >
      {items.map((it, i) => {
        const head = it.group !== last ? it.group : null;
        last = it.group;
        return (
          <div key={it.id}>
            {head && (
              <div className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-[hsl(var(--sb-text-faint))]">
                {head}
              </div>
            )}
            <button
              role="option"
              aria-selected={i === index}
              data-i={i}
              onMouseEnter={() => setIndex(i)}
              onClick={() => state.select(it)}
              className={`flex w-full flex-col rounded-lg px-2.5 py-1.5 text-left ${i === index ? "bg-[hsl(var(--sb-accent))]/15" : ""}`}
            >
              <span className="text-sm text-white">{it.title}</span>
              <span className="text-xs text-[hsl(var(--sb-text-muted))]">
                {it.description}
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}

function UrlPrompt({
  onSubmit,
  onCancel,
  pos,
}: {
  onSubmit: (url: string) => Promise<void>;
  onCancel: () => void;
  pos: { left: number; top: number; up: boolean } | null;
}) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!url.trim() || busy) return;
        setBusy(true);
        try {
          await onSubmit(url.trim());
        } finally {
          setBusy(false);
        }
      }}
      style={{ left: pos?.left ?? 24, top: pos?.top ?? 120 }}
      className="fixed z-50 flex w-80 items-center gap-2 rounded-xl border border-[hsl(var(--sb-border))] bg-[hsl(var(--sb-bg-panel))] p-2 shadow-2xl"
    >
      <Globe size={15} className="ml-1 text-[hsl(var(--sb-text-muted))]" />
      <input
        autoFocus
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onCancel()}
        placeholder="Paste a link and press Enter"
        aria-label="Bookmark URL"
        className="flex-1 bg-transparent text-sm outline-none placeholder:text-[hsl(var(--sb-text-faint))]"
      />
      {busy && <Loader2 size={14} className="animate-spin" />}
    </form>
  );
}
