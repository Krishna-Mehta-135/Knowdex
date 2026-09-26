"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Database,
  FileText,
  Loader2,
  MessageSquareText,
  Network,
  Plus,
  Sparkles,
  Upload,
} from "lucide-react";
import { useAuth } from "@/lib/auth/useAuth";
import { useDocuments } from "@/lib/documents/useDocuments";
import { useWorkspace } from "@/lib/workspaces/WorkspaceProvider";
import { createDatabase } from "@/lib/databases/api";
import { kx } from "@/lib/kx/api";
import type { HomeData } from "@/lib/kx/home";
import { formatRelativeTime } from "@/lib/utils/time";

const GraphPreview = dynamic(
  () => import("./GraphPreview").then((m) => m.GraphPreview),
  {
    ssr: false,
    loading: () => (
      <div className="h-full w-full animate-pulse rounded-2xl bg-[hsl(var(--sb-bg-hover))]/40" />
    ),
  },
);

const CTA_STYLE = {
  background: "linear-gradient(135deg,#6366f1,#7c3aed)",
  boxShadow:
    "0 4px 20px rgba(99,102,241,0.35),0 1px 0 rgba(255,255,255,0.1) inset",
};

function Stat({ n, one, many }: { n: number; one: string; many: string }) {
  return (
    <span>
      <b className="font-semibold text-white">{n}</b> {n === 1 ? one : many}
    </span>
  );
}

function greeting(): string {
  const h = new Date().getHours();
  return h < 5
    ? "Working late"
    : h < 12
      ? "Good morning"
      : h < 18
        ? "Good afternoon"
        : "Good evening";
}

export function HomeView() {
  const router = useRouter();
  const auth = useAuth();
  const { activeWorkspaceId, activeWorkspace } = useWorkspace();
  const { createDocument } = useDocuments();
  const [data, setData] = useState<HomeData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!activeWorkspaceId) return;
    let cancelled = false;
    kx<HomeData>(`workspaces/${activeWorkspaceId}/home`)
      .then((d) => !cancelled && setData(d))
      .catch(
        (e) =>
          !cancelled &&
          setError(e instanceof Error ? e.message : "Could not load"),
      );
    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceId]);

  const name = useMemo(() => {
    if (auth.status !== "authenticated") return "";
    return (auth.session.user.name ?? "").split(" ")[0] ?? "";
  }, [auth]);

  const newNote = async () => {
    setBusy("note");
    const d = await createDocument();
    if (d) router.push(`/documents/${d.id}`);
    else setBusy(null);
  };
  const newDatabase = async () => {
    if (!activeWorkspaceId) return;
    setBusy("db");
    try {
      const db = await createDatabase(
        activeWorkspaceId,
        "Task tracker",
        "tasks",
      );
      router.push(`/databases/${db.id}`);
    } catch {
      setBusy(null);
    }
  };

  const actions = [
    {
      key: "note",
      label: "New note",
      hint: "Start writing",
      icon: Plus,
      run: newNote,
      tint: "text-indigo-300 bg-indigo-500/15",
    },
    {
      key: "ask",
      label: "Ask your notes",
      hint: "Answers with sources",
      icon: MessageSquareText,
      run: () => router.push("/ask"),
      tint: "text-violet-300 bg-violet-500/15",
    },
    {
      key: "db",
      label: "New database",
      hint: "Table & board views",
      icon: Database,
      run: newDatabase,
      tint: "text-sky-300 bg-sky-500/15",
    },
    {
      key: "import",
      label: "Import & clip",
      hint: "Markdown, Notion, web",
      icon: Upload,
      run: () => router.push("/import"),
      tint: "text-fuchsia-300 bg-fuchsia-500/15",
    },
  ];

  const isEmpty = data !== null && data.counts.notes === 0;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-8 sm:py-10">
      <header className="sb-animate-in mb-8">
        <p className="text-xs font-semibold uppercase tracking-widest text-[hsl(var(--sb-accent))]">
          {activeWorkspace?.name ?? "Workspace"}
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-white">
          {greeting()}
          {name ? `, ${name}` : ""}
        </h1>
        {data && !isEmpty && (
          <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-[hsl(var(--sb-text-muted))]">
            <Stat n={data.counts.notes} one="note" many="notes" />
            <Stat n={data.counts.links} one="link" many="links" />
            {data.counts.databases > 0 && (
              <Stat n={data.counts.databases} one="database" many="databases" />
            )}
            {data.counts.files > 0 && (
              <Stat n={data.counts.files} one="file" many="files" />
            )}
          </p>
        )}
      </header>

      <section
        aria-label="Quick actions"
        className="sb-animate-in grid grid-cols-2 gap-3 lg:grid-cols-4"
        style={{ animationDelay: "0.05s" }}
      >
        {actions.map((a) => (
          <button
            key={a.key}
            onClick={() => void a.run()}
            disabled={busy !== null}
            className="group flex items-center gap-3 rounded-2xl border border-[hsl(var(--sb-border))] bg-[hsl(var(--sb-bg-panel))] p-4 text-left transition-all hover:-translate-y-0.5 hover:border-[hsl(var(--sb-accent))]/40 hover:shadow-[0_0_32px_-12px_hsla(var(--sb-accent-glow)/0.5)] disabled:opacity-60"
          >
            <span
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${a.tint}`}
            >
              {busy === a.key ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <a.icon size={18} />
              )}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-white">
                {a.label}
              </span>
              <span className="block truncate text-xs text-[hsl(var(--sb-text-faint))]">
                {a.hint}
              </span>
            </span>
          </button>
        ))}
      </section>

      {error && (
        <p className="mt-8 text-sm text-red-300">
          Couldn’t load your workspace overview: {error}
        </p>
      )}

      {!data && !error && (
        <div
          className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
          aria-hidden
        >
          {Array.from({ length: 4 }, (_, i) => (
            <div
              key={i}
              className="h-32 animate-pulse rounded-2xl bg-[hsl(var(--sb-bg-hover))]/40"
            />
          ))}
        </div>
      )}

      {isEmpty && (
        <section className="sb-animate-in mt-10 rounded-2xl border border-dashed border-[hsl(var(--sb-border-hover))] p-10 text-center">
          <div className="sb-glow mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-[hsl(var(--sb-border))] bg-[hsl(var(--sb-bg-panel))]">
            <FileText size={26} className="text-[hsl(var(--sb-accent))]" />
          </div>
          <h2 className="text-xl font-semibold text-white">
            Your knowledge base is empty
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-[hsl(var(--sb-text-muted))]">
            Write a first note, bring in an Obsidian vault or Notion export, or
            start from a database template. Everything you add becomes
            searchable and shows up in the graph.
          </p>
          <button
            onClick={() => void newNote()}
            className="mt-6 inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white transition-all hover:-translate-y-0.5 active:scale-[0.98]"
            style={CTA_STYLE}
          >
            <Plus size={16} /> Create first note
          </button>
        </section>
      )}

      {data && !isEmpty && (
        <div className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0 space-y-8">
            <section
              aria-label="Jump back in"
              className="sb-animate-in"
              style={{ animationDelay: "0.1s" }}
            >
              <h2 className="mb-3 text-sm font-medium text-[hsl(var(--sb-text-muted))]">
                Jump back in
              </h2>
              <ul className="grid gap-3 sm:grid-cols-2">
                {data.recent.slice(0, 6).map((n) => (
                  <li key={n.id}>
                    <Link
                      href={`/documents/${n.id}`}
                      className="group flex h-full flex-col rounded-2xl border border-[hsl(var(--sb-border))] bg-[hsl(var(--sb-bg-panel))] p-4 no-underline transition-all hover:border-[hsl(var(--sb-border-hover))] hover:bg-[hsl(var(--sb-bg-hover))]"
                    >
                      <span className="flex items-center gap-2">
                        <FileText
                          size={14}
                          className="shrink-0 text-[hsl(var(--sb-accent))]"
                        />
                        <span className="truncate text-sm font-medium text-white">
                          {n.title || "Untitled"}
                        </span>
                        {n.isRow && (
                          <span className="shrink-0 rounded bg-sky-500/15 px-1.5 text-[10px] text-sky-300">
                            row
                          </span>
                        )}
                      </span>
                      <span className="mt-2 line-clamp-2 min-h-[2.25rem] text-xs leading-relaxed text-[hsl(var(--sb-text-muted))]">
                        {n.snippet || "No content yet"}
                      </span>
                      <span className="mt-3 flex items-center gap-2 text-[11px] text-[hsl(var(--sb-text-faint))]">
                        {n.tags.map((t) => (
                          <span
                            key={t}
                            className="rounded-full bg-white/5 px-2 py-0.5"
                          >
                            #{t}
                          </span>
                        ))}
                        <span className="ml-auto">
                          {formatRelativeTime(n.updatedAt)}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>

            {data.suggestions.length > 0 && (
              <section
                aria-label="Connections waiting"
                className="sb-animate-in"
                style={{ animationDelay: "0.15s" }}
              >
                <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-[hsl(var(--sb-text-muted))]">
                  <Sparkles size={14} className="text-fuchsia-300" />{" "}
                  Connections waiting
                </h2>
                <ul className="divide-y divide-[hsl(var(--sb-border))] overflow-hidden rounded-2xl border border-[hsl(var(--sb-border))] bg-[hsl(var(--sb-bg-panel))]">
                  {data.suggestions.map((s) => (
                    <li
                      key={`${s.a}-${s.b}`}
                      className="flex items-center gap-3 px-4 py-3 text-sm"
                    >
                      <span className="min-w-0 flex-1 truncate">
                        <span className="font-medium text-white">
                          {s.aTitle}
                        </span>
                        <span className="mx-2 text-fuchsia-300/70">⟷</span>
                        <span className="text-[hsl(var(--sb-text-muted))]">
                          {s.bTitle}
                        </span>
                      </span>
                      <Link
                        href={`/documents/${s.a}?connect=${s.b}`}
                        className="flex shrink-0 items-center gap-1 rounded-lg border border-fuchsia-400/30 px-2.5 py-1 text-xs text-fuchsia-200 no-underline hover:bg-fuchsia-400/10"
                      >
                        Connect <ArrowRight size={12} />
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>

          <aside className="space-y-6">
            <section
              aria-label="Graph preview"
              className="sb-animate-in"
              style={{ animationDelay: "0.12s" }}
            >
              <Link
                href="/graph"
                className="group relative block h-56 overflow-hidden rounded-2xl border border-[hsl(var(--sb-border))] bg-[hsl(var(--sb-bg))] no-underline transition-colors hover:border-[hsl(var(--sb-accent))]/40"
              >
                <GraphPreview />
                <span className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/70 to-transparent px-4 pb-3 pt-8 text-xs text-white/80">
                  <span className="flex items-center gap-1.5">
                    <Network size={13} /> Knowledge graph
                  </span>
                  <ArrowRight
                    size={13}
                    className="transition-transform group-hover:translate-x-1"
                  />
                </span>
              </Link>
            </section>

            {data.databases.length > 0 && (
              <section
                aria-label="Databases"
                className="sb-animate-in"
                style={{ animationDelay: "0.18s" }}
              >
                <h2 className="mb-3 text-sm font-medium text-[hsl(var(--sb-text-muted))]">
                  Databases
                </h2>
                <ul className="space-y-2">
                  {data.databases.map((d) => (
                    <li key={d.id}>
                      <Link
                        href={`/databases/${d.id}`}
                        className="flex items-center gap-3 rounded-xl border border-[hsl(var(--sb-border))] bg-[hsl(var(--sb-bg-panel))] px-3 py-2.5 text-sm no-underline transition-colors hover:bg-[hsl(var(--sb-bg-hover))]"
                      >
                        <Database size={15} className="text-sky-300" />
                        <span className="min-w-0 flex-1 truncate text-white">
                          {d.name}
                        </span>
                        <span className="text-xs text-[hsl(var(--sb-text-faint))]">
                          {d.rowCount}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
