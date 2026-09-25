"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, FileUp, Folder, Globe, Loader2 } from "lucide-react";
import { useWorkspace } from "@/lib/workspaces/WorkspaceProvider";
import { useDocuments } from "@/lib/documents/useDocuments";
import {
  batchFiles,
  collectMarkdown,
  type ImportFile,
  type SkippedFile,
} from "@/lib/import/collect";
import { kx } from "@/lib/kx/api";

interface ImportResult {
  created: { id: string; title: string }[];
  failed: { path: string; error: string }[];
  links: number;
}

export function ImportView() {
  const params = useSearchParams();
  const [tab, setTab] = useState<"files" | "clip">(
    params.get("tab") === "clip" ? "clip" : "files",
  );
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8">
      <div
        role="tablist"
        className="mb-6 flex gap-1 rounded-xl border border-[hsl(var(--sb-border))] bg-[hsl(var(--sb-bg-panel))] p-1 text-sm"
      >
        {(
          [
            ["files", "Import files", FileUp],
            ["clip", "Clip a web page", Globe],
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 transition-colors ${tab === id ? "bg-[hsl(var(--sb-accent))]/20 text-white" : "text-[hsl(var(--sb-text-muted))] hover:text-white"}`}
          >
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>
      {tab === "files" ? <FilesTab /> : <ClipTab />}
    </div>
  );
}

function useImporter() {
  const { activeWorkspaceId } = useWorkspace();
  const { reload } = useDocuments();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (files: ImportFile[]) => {
      if (!activeWorkspaceId) return;
      setBusy(true);
      setError(null);
      setResult(null);
      const total: ImportResult = { created: [], failed: [], links: 0 };
      try {
        const batches = batchFiles(files);
        for (let i = 0; i < batches.length; i++) {
          setProgress(`Importing batch ${i + 1} of ${batches.length}…`);
          const r = await kx<ImportResult>("import", {
            method: "POST",
            json: { workspaceId: activeWorkspaceId, files: batches[i] },
          });
          total.created.push(...r.created);
          total.failed.push(...r.failed);
          total.links += r.links;
        }
        setResult(total);
        reload();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Import failed");
        if (total.created.length) setResult(total);
      } finally {
        setBusy(false);
        setProgress("");
      }
    },
    [activeWorkspaceId, reload],
  );
  return { busy, progress, result, error, run };
}

function FilesTab() {
  const [found, setFound] = useState<{
    files: ImportFile[];
    skipped: SkippedFile[];
  } | null>(null);
  const [reading, setReading] = useState(false);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const dirRef = useRef<HTMLInputElement>(null);
  const importer = useImporter();

  const read = async (list: File[]) => {
    setReading(true);
    setFound(await collectMarkdown(list));
    setReading(false);
  };

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          void read(Array.from(e.dataTransfer.files));
        }}
        className={`rounded-2xl border-2 border-dashed p-10 text-center transition-colors ${drag ? "border-[hsl(var(--sb-accent))] bg-[hsl(var(--sb-accent))]/10" : "border-[hsl(var(--sb-border-hover))]"}`}
      >
        <FileUp
          className="mx-auto mb-3 text-[hsl(var(--sb-accent))]"
          size={28}
        />
        <p className="text-sm font-medium">
          Drop Markdown files or a .zip here
        </p>
        <p className="mx-auto mt-1 max-w-sm text-xs text-[hsl(var(--sb-text-muted))]">
          Works with Obsidian vaults, Notion “Export as Markdown” zips, and
          plain .md files. [[Wiki links]] become real backlinks and everything
          is searchable in Ask.
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <button
            onClick={() => fileRef.current?.click()}
            className="rounded-lg border border-[hsl(var(--sb-border-hover))] px-3 py-1.5 text-sm hover:bg-[hsl(var(--sb-bg-hover))]"
          >
            Choose files
          </button>
          <button
            onClick={() => dirRef.current?.click()}
            className="flex items-center gap-1.5 rounded-lg border border-[hsl(var(--sb-border-hover))] px-3 py-1.5 text-sm hover:bg-[hsl(var(--sb-bg-hover))]"
          >
            <Folder size={14} /> Choose folder
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          hidden
          multiple
          accept=".md,.markdown,.txt,.zip"
          onChange={(e) => void read(Array.from(e.target.files ?? []))}
        />
        <input
          ref={dirRef}
          type="file"
          hidden
          // @ts-expect-error -- non-standard but widely supported directory picker
          webkitdirectory=""
          onChange={(e) => void read(Array.from(e.target.files ?? []))}
        />
      </div>

      {reading && (
        <p className="mt-4 flex items-center gap-2 text-sm text-[hsl(var(--sb-text-muted))]">
          <Loader2 size={14} className="animate-spin" /> Reading files…
        </p>
      )}

      {found && !reading && (
        <div className="mt-6 space-y-3">
          <p className="text-sm">
            Found <b>{found.files.length}</b> note
            {found.files.length === 1 ? "" : "s"} to import
            {found.skipped.length > 0 && (
              <span className="text-[hsl(var(--sb-text-muted))]">
                {" "}
                · {found.skipped.length} skipped
              </span>
            )}
          </p>
          {found.files.length > 0 && (
            <ul className="max-h-48 overflow-y-auto rounded-lg border border-[hsl(var(--sb-border))] p-2 text-xs text-[hsl(var(--sb-text-muted))] custom-scrollbar">
              {found.files.slice(0, 200).map((f) => (
                <li key={f.path} className="truncate px-1 py-0.5">
                  {f.path}
                </li>
              ))}
              {found.files.length > 200 && (
                <li className="px-1 py-0.5">
                  …and {found.files.length - 200} more
                </li>
              )}
            </ul>
          )}
          {found.skipped.length > 0 && (
            <details className="text-xs text-[hsl(var(--sb-text-faint))]">
              <summary className="cursor-pointer">Skipped files</summary>
              <ul className="mt-1 max-h-32 overflow-y-auto">
                {found.skipped.slice(0, 100).map((s) => (
                  <li key={s.path} className="truncate">
                    {s.path} — {s.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <button
            disabled={importer.busy || found.files.length === 0}
            onClick={() => void importer.run(found.files)}
            className="rounded-lg bg-[hsl(var(--sb-accent))] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40"
          >
            {importer.busy
              ? importer.progress || "Importing…"
              : `Import ${found.files.length} note${found.files.length === 1 ? "" : "s"}`}
          </button>
        </div>
      )}
      <ImportOutcome importer={importer} />
    </div>
  );
}

function ImportOutcome({
  importer,
}: {
  importer: ReturnType<typeof useImporter>;
}) {
  const { result, error } = importer;
  if (!result && !error) return null;
  return (
    <div className="mt-6 space-y-2 rounded-xl border border-[hsl(var(--sb-border))] bg-[hsl(var(--sb-bg-panel))] p-4 text-sm">
      {result && (
        <>
          <p className="flex items-center gap-2 font-medium">
            <CheckCircle2 size={16} className="text-emerald-400" /> Imported{" "}
            {result.created.length} note(s), {result.links} link(s)
          </p>
          {result.failed.length > 0 && (
            <p className="text-amber-300">
              {result.failed.length} failed:{" "}
              {result.failed
                .slice(0, 3)
                .map((f) => f.path)
                .join(", ")}
            </p>
          )}
          <div className="flex gap-3 pt-1">
            {result.created[0] && (
              <Link
                href={`/documents/${result.created[0].id}`}
                className="text-[hsl(var(--sb-accent))]"
              >
                Open first note
              </Link>
            )}
            <Link href="/graph" className="text-[hsl(var(--sb-accent))]">
              See it in the graph
            </Link>
          </div>
        </>
      )}
      {error && <p className="text-red-300">{error}</p>}
    </div>
  );
}

function ClipTab() {
  const [url, setUrl] = useState("");
  const [clip, setClip] = useState<{
    url: string;
    title: string;
    description: string | null;
    markdown: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const importer = useImporter();

  const fetchClip = async () => {
    setLoading(true);
    setErr(null);
    setClip(null);
    try {
      const raw = url.trim();
      setClip(
        await kx("clip", {
          method: "POST",
          json: { url: /^https?:\/\//i.test(raw) ? raw : `https://${raw}` },
        }),
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not clip page");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (url.trim()) void fetchClip();
        }}
        className="flex gap-2"
      >
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com/article"
          aria-label="Page URL"
          className="flex-1 rounded-lg border border-[hsl(var(--sb-border-hover))] bg-transparent px-3 py-2 text-sm outline-none focus:border-[hsl(var(--sb-accent))]"
        />
        <button
          disabled={loading || !url.trim()}
          className="rounded-lg bg-[hsl(var(--sb-accent))] px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          {loading ? <Loader2 size={16} className="animate-spin" /> : "Clip"}
        </button>
      </form>
      {err && <p className="mt-3 text-sm text-red-300">{err}</p>}
      {clip && (
        <div className="mt-6 space-y-3">
          <div className="rounded-xl border border-[hsl(var(--sb-border))] bg-[hsl(var(--sb-bg-panel))] p-4">
            <h3 className="font-medium">{clip.title}</h3>
            {clip.description && (
              <p className="mt-1 text-xs text-[hsl(var(--sb-text-muted))]">
                {clip.description}
              </p>
            )}
            <pre className="mt-3 max-h-56 overflow-y-auto whitespace-pre-wrap text-xs text-[hsl(var(--sb-text-muted))] custom-scrollbar">
              {clip.markdown.slice(0, 1500)}
              {clip.markdown.length > 1500 ? "…" : ""}
            </pre>
          </div>
          <button
            disabled={importer.busy}
            onClick={() =>
              void importer.run([
                {
                  path: `Clippings/${clip.title.replace(/[\\/]/g, "-")}.md`,
                  markdown: `# ${clip.title}\n\nSource: ${clip.url}\n\n${clip.markdown}`,
                },
              ])
            }
            className="rounded-lg bg-[hsl(var(--sb-accent))] px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            {importer.busy ? "Saving…" : "Save as note"}
          </button>
        </div>
      )}
      <ImportOutcome importer={importer} />
    </div>
  );
}
