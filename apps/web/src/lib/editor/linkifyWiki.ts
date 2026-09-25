import type { Editor } from "@tiptap/core";

/**
 * Turn literal `[[Title]]` text (from imported Markdown / AI output) into real
 * wikiLink nodes. Runs as one transaction, replacing from the end backwards so
 * earlier positions stay valid.
 */
export function linkifyWikiText(editor: Editor): number {
  const { state } = editor;
  const type = state.schema.nodes.wikiLink;
  if (!type) return 0;
  const hits: { from: number; to: number; title: string }[] = [];
  state.doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    const re = /\[\[([^\]\n]{1,120})\]\]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(node.text))) {
      hits.push({
        from: pos + m.index,
        to: pos + m.index + m[0].length,
        title: m[1]!.trim(),
      });
    }
  });
  if (hits.length === 0) return 0;
  const tr = state.tr;
  for (const h of hits.reverse())
    tr.replaceWith(h.from, h.to, type.create({ title: h.title }));
  editor.view.dispatch(tr);
  return hits.length;
}
