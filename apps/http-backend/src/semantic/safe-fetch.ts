import { lookup } from "node:dns/promises";
import net from "node:net";

/** True for loopback, private, link-local, CGNAT and other non-public addresses. */
export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number) as [number, number];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    if (l === "::1" || l === "::") return true;
    if (l.startsWith("fc") || l.startsWith("fd") || l.startsWith("fe80"))
      return true;
    const m = l.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (m) return isPrivateIp(m[1]!);
    return false;
  }
  return true;
}

export class UnsafeUrlError extends Error {}

export async function assertPublicUrl(raw: string): Promise<URL> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new UnsafeUrlError("Invalid URL");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new UnsafeUrlError("Only http(s) URLs are allowed");
  }
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host)) {
    if (isPrivateIp(host))
      throw new UnsafeUrlError("Private addresses are not allowed");
    return u;
  }
  const addrs = await lookup(host, { all: true }).catch(() => {
    throw new UnsafeUrlError("Could not resolve host");
  });
  if (addrs.length === 0 || addrs.some((a) => isPrivateIp(a.address))) {
    throw new UnsafeUrlError("Private addresses are not allowed");
  }
  return u;
}

/** GET a public web page with SSRF protection, redirect re-validation and a size cap. */
export async function safeFetchText(
  raw: string,
  opts: { maxBytes?: number; timeoutMs?: number } = {},
): Promise<{ url: string; contentType: string; body: string }> {
  const maxBytes = opts.maxBytes ?? 2_000_000;
  let url = await assertPublicUrl(raw);
  for (let hop = 0; hop < 4; hop++) {
    const res = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
      headers: {
        "User-Agent": "KnowdexClipper/1.0",
        Accept: "text/html,text/plain;q=0.9,*/*;q=0.5",
      },
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) throw new Error("Redirect without location");
      url = await assertPublicUrl(new URL(loc, url).toString());
      continue;
    }
    if (!res.ok) throw new Error(`Upstream responded ${res.status}`);
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel();
          break;
        }
        chunks.push(value);
      }
    }
    return {
      url: url.toString(),
      contentType: res.headers.get("content-type") ?? "",
      body: Buffer.concat(chunks).toString("utf8"),
    };
  }
  throw new Error("Too many redirects");
}
