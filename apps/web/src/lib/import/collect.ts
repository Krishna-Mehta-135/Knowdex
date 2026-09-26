export interface ImportFile {
  path: string;
  markdown: string;
}
export interface SkippedFile {
  path: string;
  reason: string;
}

const MD = /\.(md|markdown|txt)$/i;
export const MAX_FILE_CHARS = 500_000;
const MAX_FILES = 3000;

const ignored = (p: string) =>
  p.startsWith("__MACOSX/") ||
  p.split("/").some((seg) => seg.startsWith(".") && seg !== ".") ||
  p.includes("/node_modules/");

async function fromZip(
  buf: ArrayBuffer,
  prefix: string,
  out: ImportFile[],
  skipped: SkippedFile[],
  depth: number,
) {
  // Loaded on demand: zip support is only needed on the import page.
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(buf);
  for (const entry of Object.values(zip.files)) {
    if (entry.dir || ignored(entry.name)) continue;
    const path = prefix + entry.name;
    if (out.length >= MAX_FILES) {
      skipped.push({ path, reason: `limit of ${MAX_FILES} notes reached` });
      continue;
    }
    if (/\.zip$/i.test(entry.name) && depth < 2) {
      // Notion exports are often a zip containing a zip.
      await fromZip(
        await entry.async("arraybuffer"),
        path.replace(/\.zip$/i, "/"),
        out,
        skipped,
        depth + 1,
      );
    } else if (MD.test(entry.name)) {
      const text = await entry.async("string");
      if (text.length > MAX_FILE_CHARS)
        skipped.push({ path, reason: "larger than 500K characters" });
      else out.push({ path, markdown: text });
    }
  }
}

/** Gather Markdown notes from dropped files, folders and .zip archives. */
export async function collectMarkdown(
  files: File[],
): Promise<{ files: ImportFile[]; skipped: SkippedFile[] }> {
  const out: ImportFile[] = [];
  const skipped: SkippedFile[] = [];
  for (const f of files) {
    const rel =
      (f as File & { webkitRelativePath?: string }).webkitRelativePath ||
      f.name;
    if (ignored(rel)) continue;
    try {
      if (/\.zip$/i.test(f.name)) {
        await fromZip(await f.arrayBuffer(), "", out, skipped, 0);
      } else if (MD.test(f.name)) {
        const text = await f.text();
        if (text.length > MAX_FILE_CHARS)
          skipped.push({ path: rel, reason: "larger than 500K characters" });
        else out.push({ path: rel, markdown: text });
      } else {
        skipped.push({ path: rel, reason: "not a Markdown or zip file" });
      }
    } catch {
      skipped.push({ path: rel, reason: "could not be read" });
    }
  }
  return { files: out, skipped };
}

/** Split into requests that stay well under the server's body limit. */
export function batchFiles(
  files: ImportFile[],
  maxFiles = 250,
  maxChars = 6_000_000,
): ImportFile[][] {
  const batches: ImportFile[][] = [];
  let cur: ImportFile[] = [];
  let size = 0;
  for (const f of files) {
    if (
      cur.length > 0 &&
      (cur.length >= maxFiles || size + f.markdown.length > maxChars)
    ) {
      batches.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(f);
    size += f.markdown.length;
  }
  if (cur.length) batches.push(cur);
  return batches;
}
