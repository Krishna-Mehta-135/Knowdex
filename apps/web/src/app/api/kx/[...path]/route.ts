import { NextRequest } from "next/server";
import { API_BASE_URL } from "@/lib/api/config";

/**
 * Authenticated pass-through to the backend's /api/v1/kx/* routes.
 * Streams request and response bodies so uploads, SSE answers and file
 * downloads work without buffering.
 */
async function proxy(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const token = req.cookies.get("session")?.value;
  if (!token) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { path } = await params;
  const url = `${API_BASE_URL}/api/v1/kx/${path.map(encodeURIComponent).join("/")}${req.nextUrl.search}`;

  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  const ct = req.headers.get("content-type");
  if (ct) headers["Content-Type"] = ct;

  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  try {
    const upstream = await fetch(url, {
      method: req.method,
      headers,
      body: hasBody ? req.body : undefined,
      // @ts-expect-error -- required by undici when streaming a request body
      duplex: hasBody ? "half" : undefined,
      signal: req.signal,
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
    return new Response(upstream.body, {
      status: upstream.status,
      headers: out,
    });
  } catch (err) {
    if (req.signal.aborted) return new Response(null, { status: 499 });
    console.error("[kx proxy]", err);
    return Response.json({ error: "Upstream unavailable" }, { status: 502 });
  }
}

export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
export const PUT = proxy;
export const DELETE = proxy;
export const dynamic = "force-dynamic";
