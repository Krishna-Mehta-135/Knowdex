import { NextRequest } from "next/server";
import { API_BASE_URL } from "@/lib/api/config";

/** Unauthenticated pass-through for images/PDFs of *public* notes (backend enforces access). */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ docId: string; id: string }> },
) {
  const { docId, id } = await params;
  try {
    const upstream = await fetch(
      `${API_BASE_URL}/api/v1/public/attachments/${encodeURIComponent(docId)}/${encodeURIComponent(id)}`,
    );
    if (!upstream.ok)
      return new Response("Not found", {
        status: upstream.status === 404 ? 404 : 502,
      });
    const out = new Headers();
    for (const h of [
      "content-type",
      "content-length",
      "content-disposition",
      "content-security-policy",
      "x-content-type-options",
      "cache-control",
    ]) {
      const v = upstream.headers.get(h);
      if (v) out.set(h, v);
    }
    return new Response(upstream.body, { status: 200, headers: out });
  } catch {
    return new Response("Upstream unavailable", { status: 502 });
  }
}
