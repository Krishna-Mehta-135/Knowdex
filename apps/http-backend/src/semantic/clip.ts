/** Minimal HTML → readable Markdown, good enough for clipping articles. */
function decode(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)));
}

export function extractMeta(html: string, prop: string): string | null {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']*)["']|<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${prop}["']`,
    "i",
  );
  const m = html.match(re);
  const v = m?.[1] ?? m?.[2];
  return v ? decode(v).trim() : null;
}

export function htmlToMarkdown(html: string): {
  title: string;
  markdown: string;
  description: string | null;
  image: string | null;
} {
  const title =
    extractMeta(html, "og:title") ??
    decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").trim() ??
    "";
  const description =
    extractMeta(html, "og:description") ?? extractMeta(html, "description");
  const image = extractMeta(html, "og:image");

  let body = html.replace(/<head[\s\S]*?<\/head>/i, "");
  const article =
    body.match(/<article[\s\S]*?<\/article>/i)?.[0] ??
    body.match(/<main[\s\S]*?<\/main>/i)?.[0];
  if (article) body = article;
  body = body
    .replace(
      /<(script|style|noscript|svg|nav|header|footer|aside|form|iframe)[\s\S]*?<\/\1>/gi,
      "",
    )
    .replace(/<!--[\s\S]*?-->/g, "");

  let md = body
    .replace(
      /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi,
      (_, l: string, t: string) =>
        `\n\n${"#".repeat(Number(l))} ${t.replace(/<[^>]+>/g, "").trim()}\n\n`,
    )
    .replace(
      /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
      (_, h: string, t: string) => {
        const label = t.replace(/<[^>]+>/g, "").trim();
        return label && /^https?:/.test(h) ? `[${label}](${h})` : label;
      },
    )
    .replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, "**$2**")
    .replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, "*$2*")
    .replace(
      /<li[^>]*>([\s\S]*?)<\/li>/gi,
      (_, t: string) => `\n- ${t.replace(/<[^>]+>/g, "").trim()}`,
    )
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|ul|ol|blockquote|tr)>/gi, "\n\n")
    .replace(/<[^>]+>/g, "");
  md = decode(md)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { title: title || "Clipped page", markdown: md, description, image };
}
