"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Database, Loader2, Plus } from "lucide-react";
import { useWorkspace } from "@/lib/workspaces/WorkspaceProvider";
import { createDatabase, listDatabases } from "@/lib/databases/api";
import type { DatabaseMeta } from "@/lib/databases/types";

const TEMPLATES = [
  {
    id: "tasks",
    title: "Task tracker",
    desc: "Status, due date, priority and tags, with a kanban board.",
  },
  {
    id: "reading",
    title: "Reading list",
    desc: "Track books and articles from queue to finished.",
  },
  {
    id: "blank",
    title: "Blank database",
    desc: "Start with just tags and add your own properties.",
  },
] as const;

export function DatabaseList() {
  const { activeWorkspaceId } = useWorkspace();
  const router = useRouter();
  const [dbs, setDbs] = useState<DatabaseMeta[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!activeWorkspaceId) return;
    try {
      setDbs(await listDatabases(activeWorkspaceId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load databases");
    }
  }, [activeWorkspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async (template: (typeof TEMPLATES)[number]) => {
    if (!activeWorkspaceId) return;
    setCreating(template.id);
    try {
      const db = await createDatabase(
        activeWorkspaceId,
        template.id === "blank" ? "Untitled database" : template.title,
        template.id,
      );
      router.push(`/databases/${db.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create database");
      setCreating(null);
    }
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      {error && <p className="mb-4 text-sm text-red-300">{error}</p>}

      <h2 className="mb-3 text-sm font-medium text-[hsl(var(--sb-text-muted))]">
        Your databases
      </h2>
      {dbs === null ? (
        <p className="text-sm text-[hsl(var(--sb-text-faint))]">Loading…</p>
      ) : dbs.length === 0 ? (
        <p className="text-sm text-[hsl(var(--sb-text-faint))]">
          No databases yet — start from a template below.
        </p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {dbs.map((d) => (
            <li key={d.id}>
              <Link
                href={`/databases/${d.id}`}
                className="flex items-center gap-3 rounded-xl border border-[hsl(var(--sb-border))] bg-[hsl(var(--sb-bg-panel))] px-4 py-3 no-underline hover:bg-[hsl(var(--sb-bg-hover))]"
              >
                <Database size={18} className="text-[hsl(var(--sb-accent))]" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-white">
                  {d.name}
                </span>
                <span className="text-xs text-[hsl(var(--sb-text-faint))]">
                  {d.rowCount ?? 0} rows
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <h2 className="mb-3 mt-10 text-sm font-medium text-[hsl(var(--sb-text-muted))]">
        New database
      </h2>
      <ul className="grid gap-2 sm:grid-cols-3">
        {TEMPLATES.map((t) => (
          <li key={t.id}>
            <button
              onClick={() => void create(t)}
              disabled={creating !== null}
              className="flex h-full w-full flex-col items-start gap-1 rounded-xl border border-dashed border-[hsl(var(--sb-border-hover))] p-4 text-left hover:bg-[hsl(var(--sb-bg-hover))] disabled:opacity-50"
            >
              <span className="flex items-center gap-2 text-sm font-medium text-white">
                {creating === t.id ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Plus size={14} />
                )}{" "}
                {t.title}
              </span>
              <span className="text-xs text-[hsl(var(--sb-text-muted))]">
                {t.desc}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
