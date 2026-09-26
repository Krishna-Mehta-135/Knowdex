"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, Database } from "lucide-react";
import { useDocuments } from "@/lib/documents/useDocuments";
import { getRow, updateRow } from "@/lib/databases/api";
import {
  PROP_TYPE_LABELS,
  type DatabaseMeta,
  type PropValue,
  type Row,
} from "@/lib/databases/types";
import { Cell } from "@/components/databases/Cell";

/**
 * Notion-style page properties: when the open note is a database row, show its
 * typed properties above the content, editable in place.
 */
export function RowProperties({ docId }: { docId: string }) {
  const { documents } = useDocuments();
  const databaseId = documents.find((d) => d.id === docId)?.databaseId ?? null;
  const [state, setState] = useState<{ db: DatabaseMeta; row: Row } | null>(
    null,
  );

  useEffect(() => {
    setState(null);
    if (!databaseId) return;
    let cancelled = false;
    getRow(databaseId, docId)
      .then((r) => !cancelled && setState({ db: r.database, row: r.row }))
      .catch(() => {
        /* panel is best-effort (e.g. offline) */
      });
    return () => {
      cancelled = true;
    };
  }, [databaseId, docId]);

  const change = useCallback(
    async (propId: string, value: PropValue) => {
      if (!state) return;
      const before = state;
      const props = { ...state.row.props, [propId]: value };
      if (value === null) delete props[propId];
      setState({ ...state, row: { ...state.row, props } }); // optimistic
      try {
        const saved = await updateRow(state.db.id, docId, {
          props: { [propId]: value },
        });
        setState((s) => (s ? { ...s, row: saved } : s));
      } catch (e) {
        setState(before);
        toast.error(e instanceof Error ? e.message : "Could not save property");
      }
    },
    [state, docId],
  );

  if (!databaseId || !state) return null;

  return (
    <section
      aria-label="Properties"
      className="mb-6 rounded-2xl border border-[hsl(var(--sb-border))] bg-[hsl(var(--sb-bg-panel))]/60 p-3"
    >
      <Link
        href={`/databases/${state.db.id}`}
        className="mb-2 inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-[hsl(var(--sb-text-muted))] no-underline hover:bg-[hsl(var(--sb-bg-hover))] hover:text-white"
      >
        <ArrowLeft size={12} /> <Database size={12} className="text-sky-300" />{" "}
        {state.db.name}
      </Link>
      <dl className="grid grid-cols-[112px_minmax(0,1fr)] items-center gap-y-0.5 text-sm">
        {state.db.schema.map((p) => (
          <div key={p.id} className="contents">
            <dt
              className="truncate px-2 text-xs text-[hsl(var(--sb-text-faint))]"
              title={PROP_TYPE_LABELS[p.type]}
            >
              {p.name}
            </dt>
            <dd className="min-w-0">
              <Cell
                prop={p}
                value={state.row.props[p.id]}
                onChange={(v) => void change(p.id, v)}
              />
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
