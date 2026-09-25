import MarkdownIt from "markdown-it";
import * as Y from "yjs";
import {
  getSchema,
  mergeAttributes,
  Node,
  type JSONContent,
} from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import {
  Table,
  TableCell,
  TableHeader,
  TableRow,
} from "@tiptap/extension-table";
import { generateJSON } from "@tiptap/html/server";
import { prosemirrorJSONToYXmlFragment } from "@tiptap/y-tiptap";

/** Schema-only twin of the web app's inline `[[Title]]` node. */
const WikiLink = Node.create({
  name: "wikiLink",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes() {
    return { title: { default: null } };
  },
  parseHTML() {
    return [{ tag: 'span[data-type="wiki-link"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, { "data-type": "wiki-link" }),
    ];
  },
});

const extensions = [
  StarterKit,
  TaskList,
  TaskItem.configure({ nested: true }),
  Table,
  TableRow,
  TableHeader,
  TableCell,
  WikiLink,
];
const schema = getSchema(extensions);
const md = new MarkdownIt({ html: false, linkify: true, breaks: false });

export interface ConvertedNote {
  title: string;
  tags: string[];
  json: JSONContent;
  /** Titles referenced via [[wiki links]]. */
  links: string[];
}

const NOTION_HASH = /\s+[0-9a-f]{32}$/i;

/** "Folder/My Note 1a2b…(32 hex).md" -> "My Note" */
export function titleFromPath(path: string): string {
  const base = path.split("/").pop() ?? path;
  const name = base
    .replace(/\.(md|markdown|txt)$/i, "")
    .replace(NOTION_HASH, "")
    .trim();
  return name || "Untitled";
}

export function folderFromPath(path: string): string {
  const parts = path
    .split("/")
    .slice(0, -1)
    .map((p) => p.replace(NOTION_HASH, "").trim())
    .filter(Boolean);
  return parts.join(" / ").slice(0, 500);
}

function parseFrontmatter(src: string): {
  body: string;
  title?: string;
  tags: string[];
} {
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { body: src, tags: [] };
  const fm = m[1]!;
  let title: string | undefined;
  const tags: string[] = [];
  const t = fm.match(/^title:\s*(.+)$/im);
  if (t) title = t[1]!.trim().replace(/^["']|["']$/g, "");
  const block = fm.match(/^tags?:[ \t]*\n((?:[ \t]*-[ \t]*.+\n?)+)/im);
  if (block) {
    tags.push(
      ...block[1]!.split("\n").map((l) => l.replace(/^[ \t]*-[ \t]*/, "")),
    );
  } else {
    const inline =
      fm.match(/^tags?:[ \t]*\[(.*)\][ \t]*$/im) ??
      fm.match(/^tags?:[ \t]*([^\n\[-][^\n]*)$/im);
    if (inline) tags.push(...inline[1]!.split(/[,\s]+/));
  }
  const clean = tags
    .map((x) =>
      x
        .trim()
        .replace(/^#/, "")
        .replace(/^["']|["']$/g, ""),
    )
    .filter(Boolean);
  return {
    body: src.slice(m[0].length),
    title,
    tags: [...new Set(clean)].slice(0, 12),
  };
}

function normalizeLinks(src: string): string {
  return (
    src
      // Obsidian embeds: ![[file.png]] — the file isn't imported, keep a marker
      .replace(
        /!\[\[([^\]\n]+)\]\]/g,
        (_, n: string) => `*[embedded: ${n.split("|")[0]}]*`,
      )
      // [[Title|alias]] and [[Title#Heading]] -> [[Title]]
      .replace(
        /\[\[([^\]\n|#]+)(?:[#|][^\]\n]*)?\]\]/g,
        (_, t: string) => `[[${t.trim()}]]`,
      )
      // Notion/relative markdown links to other pages -> wiki links
      .replace(
        /\[([^\]]*)\]\((?!https?:|mailto:|#)([^)\s]+?\.md)\)/gi,
        (_, _label: string, href: string) => {
          let decoded = href;
          try {
            decoded = decodeURIComponent(href);
          } catch {
            /* keep raw */
          }
          return `[[${titleFromPath(decoded)}]]`;
        },
      )
  );
}

const escapeAttr = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

function postProcessHtml(html: string, links: Set<string>): string {
  // Leave code untouched: only rewrite text outside <pre>/<code>.
  const parts = html.split(/(<pre[\s\S]*?<\/pre>|<code[\s\S]*?<\/code>)/g);
  const out = parts.map((seg, i) => {
    if (i % 2 === 1) return seg;
    return seg.replace(/\[\[([^\]\n<]{1,120})\]\]/g, (_, t: string) => {
      const title = t.trim();
      links.add(title);
      return `<span data-type="wiki-link" title="${escapeAttr(title)}">[[${escapeAttr(title)}]]</span>`;
    });
  });
  let res = out.join("");
  // `- [ ] item` / `- [x] item` lists -> Tiptap task lists.
  res = res.replace(
    /<ul>((?:(?!<\/?ul>)[\s\S])*?)<\/ul>/g,
    (whole, inner: string) => {
      const items = inner.match(/<li>[\s\S]*?<\/li>/g);
      if (
        !items ||
        !items.every((li) => /^<li>\s*(?:<p>)?\[[ xX]\]\s/.test(li))
      )
        return whole;
      const lis = items.map((li) => {
        const checked = /^<li>\s*(?:<p>)?\[[xX]\]/.test(li);
        const text = li
          .replace(/^<li>\s*(?:<p>)?\[[ xX]\]\s*/, "")
          .replace(/(?:<\/p>)?\s*<\/li>$/, "");
        return `<li data-type="taskItem" data-checked="${checked}"><p>${text}</p></li>`;
      });
      return `<ul data-type="taskList">${lis.join("")}</ul>`;
    },
  );
  return res;
}

export function convertMarkdown(source: string, path: string): ConvertedNote {
  const fm = parseFrontmatter(source.replace(/^﻿/, ""));
  const body = normalizeLinks(fm.body);
  const links = new Set<string>();
  const html = postProcessHtml(md.render(body), links);
  const json = generateJSON(html || "<p></p>", extensions) as JSONContent;
  const title = (fm.title || titleFromPath(path)).slice(0, 200);
  links.delete(title);
  return { title, tags: fm.tags, json, links: [...links] };
}

/** Encode ProseMirror JSON as the persisted Y.Doc state the editor loads. */
export function jsonToYState(json: JSONContent): Uint8Array {
  const doc = new Y.Doc();
  prosemirrorJSONToYXmlFragment(schema, json, doc.getXmlFragment("content"));
  const state = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return state;
}
