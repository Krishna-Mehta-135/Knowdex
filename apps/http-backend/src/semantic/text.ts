import * as Y from "yjs";

const BLOCK_NODES = new Set([
  "paragraph",
  "heading",
  "listItem",
  "taskItem",
  "blockquote",
  "codeBlock",
  "tableRow",
  "callout",
  "hardBreak",
]);

function walk(node: Y.XmlFragment | Y.XmlElement | Y.XmlText, out: string[]) {
  if (node instanceof Y.XmlText) {
    for (const op of node.toDelta() as Array<{ insert?: unknown }>) {
      if (typeof op.insert === "string") out.push(op.insert);
    }
    return;
  }
  const name = node instanceof Y.XmlElement ? node.nodeName : "";
  if (name === "wikiLink" && node instanceof Y.XmlElement) {
    const t = node.getAttribute("title");
    if (typeof t === "string") out.push(t);
    return;
  }
  if (name === "pdfAttachment" && node instanceof Y.XmlElement) {
    const t = node.getAttribute("name");
    if (typeof t === "string") out.push(`[file: ${t}]`);
    return;
  }
  node.forEach((child) => {
    walk(child as Y.XmlElement | Y.XmlText, out);
  });
  if (BLOCK_NODES.has(name) || name === "") out.push("\n");
}

/** Plain text of a persisted Y.Doc state (the Tiptap "content" fragment). */
export function extractPlainText(state: Uint8Array): string {
  if (!state || state.byteLength === 0) return "";
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, state);
    const out: string[] = [];
    walk(doc.getXmlFragment("content"), out);
    return out
      .join("")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  } catch {
    return "";
  } finally {
    doc.destroy();
  }
}
