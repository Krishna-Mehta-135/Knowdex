"use client";

import { Check, Sparkles, Square, X } from "lucide-react";
import { useDocument } from "@/lib/sync/useDocument";
import { useAIPresence } from "@/lib/sync/useAIPresence";
import type { PendingSuggestion } from "./hooks/useAIWriter";

interface Props {
  writing: boolean;
  pending: PendingSuggestion | null;
  onStop: () => void;
  onAccept: () => void;
  onDiscard: () => void;
}

/**
 * Shows the AI as a collaborator: while it writes, everyone in the note sees
 * who asked for it and the text as it streams; the requester then reviews it.
 */
export function AILiveBanner({
  writing,
  pending,
  onStop,
  onAccept,
  onDiscard,
}: Props) {
  const { awareness } = useDocument();
  const sessions = useAIPresence(awareness);
  const others = sessions.filter((s) => !s.isSelf);
  const mine = sessions.find((s) => s.isSelf);

  if (!writing && !pending && others.length === 0) return null;

  const card =
    "pointer-events-auto w-[min(640px,92vw)] rounded-2xl border border-fuchsia-400/30 bg-[hsl(var(--sb-bg-panel))]/95 p-3 shadow-2xl backdrop-blur";

  return (
    <div
      className="pointer-events-none fixed bottom-20 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2"
      aria-live="polite"
    >
      {others.map((s) => (
        <div key={s.clientId} className={card}>
          <div className="mb-1.5 flex items-center gap-2 text-xs font-medium text-fuchsia-200">
            <Sparkles size={14} className="animate-pulse" /> Knowdex AI is
            writing for {s.requestedBy}…
          </div>
          <pre className="max-h-36 overflow-y-auto whitespace-pre-wrap font-sans text-xs text-[hsl(var(--sb-text-muted))]">
            {s.text || "…"}
          </pre>
        </div>
      ))}

      {writing && (
        <div className={card}>
          <div className="mb-1.5 flex items-center gap-2 text-xs font-medium text-fuchsia-200">
            <Sparkles size={14} className="animate-pulse" /> Knowdex AI is
            writing…
            <button
              onClick={onStop}
              className="ml-auto flex items-center gap-1 rounded-md px-2 py-0.5 text-[hsl(var(--sb-text-muted))] hover:bg-[hsl(var(--sb-bg-hover))] hover:text-white"
            >
              <Square size={11} /> Stop
            </button>
          </div>
          <pre className="max-h-36 overflow-y-auto whitespace-pre-wrap font-sans text-xs text-[hsl(var(--sb-text-muted))]">
            {mine?.text || "Thinking…"}
          </pre>
        </div>
      )}

      {pending && (
        <div className={card}>
          <div className="mb-1.5 flex items-center gap-2 text-xs font-medium text-fuchsia-200">
            <Sparkles size={14} /> AI suggestion — review before it’s added
          </div>
          <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap font-sans text-xs text-[hsl(var(--sb-text))]">
            {pending.markdown}
          </pre>
          <div className="mt-2 flex justify-end gap-2">
            <button
              onClick={onDiscard}
              className="flex items-center gap-1 rounded-lg border border-[hsl(var(--sb-border-hover))] px-3 py-1.5 text-xs hover:bg-[hsl(var(--sb-bg-hover))]"
            >
              <X size={13} /> Discard
            </button>
            <button
              onClick={onAccept}
              className="flex items-center gap-1 rounded-lg bg-fuchsia-500/80 px-3 py-1.5 text-xs font-medium text-white hover:bg-fuchsia-500"
            >
              <Check size={13} /> Insert
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
