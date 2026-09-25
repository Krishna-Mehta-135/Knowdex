"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Link2, Sparkles } from "lucide-react";
import { kx, type RelatedNote, type UnlinkedMention } from "@/lib/kx/api";
import { useDocuments } from "@/lib/documents/useDocuments";

const insertLink = (title: string) =>
  window.dispatchEvent(
    new CustomEvent("knowdex:insert-wikilink", { detail: { title } }),
  );

/** Semantically related notes and unlinked mentions, each one click from a real [[link]]. */
export function RelatedPanel({ docId }: { docId: string }) {
  const [related, setRelated] = useState<RelatedNote[]>([]);
  const [mentions, setMentions] = useState<UnlinkedMention[]>([]);
  const [linkedNow, setLinkedNow] = useState<Set<string>>(new Set());
  const { documents } = useDocuments();
  const params = useSearchParams();
  const connectId = params.get("connect");

  const load = useCallback(async () => {
    try {
      const [r, m] = await Promise.all([
        kx<RelatedNote[]>(`documents/${docId}/related`),
        kx<UnlinkedMention[]>(`documents/${docId}/unlinked-mentions`),
      ]);
      setRelated(r);
      setMentions(m);
    } catch {
      /* panel is best-effort */
    }
  }, [docId]);

  useEffect(() => {
    setRelated([]);
    setMentions([]);
    setLinkedNow(new Set());
    void load();
    // Notes are (re)indexed in the background shortly after edits.
    const id = setInterval(
      () => document.visibilityState === "visible" && void load(),
      45_000,
    );
    return () => clearInterval(id);
  }, [load]);

  const connectTitle = connectId
    ? documents.find((d) => d.id === connectId)?.title
    : null;
  const suggested = related.filter((r) => !r.linked && !linkedNow.has(r.id));
  const showConnect = connectId && connectTitle && !linkedNow.has(connectId);
  if (!showConnect && suggested.length === 0 && mentions.length === 0)
    return null;

  const link = (id: string, title: string) => {
    insertLink(title);
    setLinkedNow((s) => new Set(s).add(id));
  };

  return (
    <div className="mt-12 space-y-8 border-t border-[hsl(var(--sb-border))] pt-8">
      {showConnect && (
        <div className="flex items-center gap-3 rounded-xl border border-fuchsia-400/30 bg-fuchsia-400/10 px-4 py-3 text-sm">
          <Sparkles size={16} className="shrink-0 text-fuchsia-300" />
          <span className="min-w-0 flex-1">
            The graph thinks this note relates to{" "}
            <b className="font-semibold">{connectTitle}</b>.
          </span>
          <button
            onClick={() => link(connectId!, connectTitle!)}
            className="rounded-lg bg-fuchsia-400/20 px-3 py-1.5 text-xs font-medium hover:bg-fuchsia-400/30"
          >
            Insert link
          </button>
        </div>
      )}

      {suggested.length > 0 && (
        <section aria-label="Related notes">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
            <Sparkles size={15} className="text-fuchsia-300" /> Related by
            meaning
          </h3>
          <ul className="max-w-2xl divide-y divide-[hsl(var(--sb-border))] overflow-hidden rounded-lg border border-[hsl(var(--sb-border))] bg-[hsl(var(--sb-bg))]/80">
            {suggested.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-3 py-2">
                <Link
                  href={`/documents/${r.id}`}
                  className="min-w-0 flex-1 truncate text-[13px] font-medium text-[hsl(var(--sb-accent))] no-underline hover:underline"
                >
                  {r.title}
                </Link>
                <span className="text-[11px] tabular-nums text-[hsl(var(--sb-text-faint))]">
                  {Math.round(r.score * 100)}%
                </span>
                <button
                  onClick={() => link(r.id, r.title)}
                  className="rounded-md px-2 py-1 text-xs text-[hsl(var(--sb-text-muted))] hover:bg-[hsl(var(--sb-bg-hover))] hover:text-white"
                >
                  Link
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {mentions.length > 0 && (
        <section aria-label="Unlinked mentions">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
            <Link2 size={15} className="text-[hsl(var(--sb-accent))]" />{" "}
            Unlinked mentions
          </h3>
          <ul className="max-w-2xl divide-y divide-[hsl(var(--sb-border))] overflow-hidden rounded-lg border border-[hsl(var(--sb-border))] bg-[hsl(var(--sb-bg))]/80">
            {mentions.map((m) => (
              <li key={m.id} className="px-3 py-2">
                <Link
                  href={`/documents/${m.id}`}
                  className="text-[13px] font-medium text-[hsl(var(--sb-accent))] no-underline hover:underline"
                >
                  {m.title}
                </Link>
                <p className="mt-0.5 line-clamp-2 text-xs text-[hsl(var(--sb-text-muted))]">
                  {m.snippet}
                </p>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-[hsl(var(--sb-text-faint))]">
            These notes mention this title in plain text. Open one and type [[
            to link it.
          </p>
        </section>
      )}
    </div>
  );
}
