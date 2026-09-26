import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { API_BASE_URL } from "@/lib/api/config";

interface PublicNote {
  id: string;
  title: string;
  html: string;
  description: string;
  updatedAt: number;
}

async function load(docId: string): Promise<PublicNote | null> {
  try {
    const res = await fetch(
      `${API_BASE_URL}/api/v1/public/notes/${encodeURIComponent(docId)}`,
      {
        next: { revalidate: 30 },
      },
    );
    if (!res.ok) return null;
    return ((await res.json()) as { data: PublicNote }).data;
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ docId: string }>;
}): Promise<Metadata> {
  const { docId } = await params;
  const note = await load(docId);
  if (!note) return { title: "Not found — Knowdex", robots: { index: false } };
  return {
    title: `${note.title} — Knowdex`,
    description: note.description,
    openGraph: {
      title: note.title,
      description: note.description,
      type: "article",
    },
  };
}

/** Public, login-free, read-only view of a published note. */
export default async function PublicNotePage({
  params,
}: {
  params: Promise<{ docId: string }>;
}) {
  const { docId } = await params;
  const note = await load(docId);
  if (!note) notFound();

  return (
    <div className="min-h-screen bg-[#0a0a0b] text-[#f2f2f2]">
      <header className="border-b border-white/10">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-4 text-sm">
          <Link
            href="/"
            className="font-semibold tracking-tight text-white no-underline"
          >
            Knowdex
          </Link>
          <span className="text-white/40">Published note</span>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-5 py-10">
        <h1 className="mb-8 text-4xl font-bold tracking-tight">{note.title}</h1>
        <article
          className="ProseMirror prose prose-invert max-w-none prose-a:text-violet-300"
          // Sanitised server-side with an allowlist (no scripts, handlers or javascript: URLs).
          dangerouslySetInnerHTML={{ __html: note.html }}
        />
        <p className="mt-16 border-t border-white/10 pt-4 text-xs text-white/40">
          Last updated{" "}
          {new Date(note.updatedAt).toLocaleDateString(undefined, {
            year: "numeric",
            month: "long",
            day: "numeric",
          })}
        </p>
      </main>
    </div>
  );
}
