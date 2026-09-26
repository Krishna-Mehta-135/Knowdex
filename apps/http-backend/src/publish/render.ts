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
import { generateHTML } from "@tiptap/html/server";
import { yXmlFragmentToProsemirrorJSON } from "@tiptap/y-tiptap";
import sanitizeHtml from "sanitize-html";

/** Server-side twins of the editor's custom nodes, rendered for public reading. */
const WikiLink = Node.create({
  name: "wikiLink",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes() {
    return { title: { default: null } };
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-wiki": HTMLAttributes.title ?? "",
      }),
      `[[${HTMLAttributes.title ?? ""}]]`,
    ];
  },
});

const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  addAttributes() {
    return { kind: { default: "info" } };
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      {
        "data-callout": "",
        "data-kind": String(HTMLAttributes.kind ?? "info"),
      },
      0,
    ];
  },
});

const FileAttachment = Node.create({
  name: "fileAttachment",
  group: "block",
  atom: true,
  addAttributes() {
    return {
      id: { default: "" },
      name: { default: "file" },
      size: { default: 0 },
      mime: { default: "" },
    };
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "p",
      { "data-file": String(HTMLAttributes.id ?? "") },
      `📎 ${HTMLAttributes.name ?? "file"}`,
    ];
  },
});

const Bookmark = Node.create({
  name: "bookmark",
  group: "block",
  atom: true,
  addAttributes() {
    return {
      url: { default: "" },
      title: { default: "" },
      description: { default: "" },
      image: { default: "" },
    };
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "p",
      [
        "a",
        { href: String(HTMLAttributes.url ?? "") },
        String(HTMLAttributes.title || HTMLAttributes.url || "link"),
      ],
    ];
  },
});

const Image = Node.create({
  name: "image",
  group: "block",
  atom: true,
  addAttributes() {
    return {
      src: { default: "" },
      alt: { default: "" },
      title: { default: null },
    };
  },
  renderHTML({ HTMLAttributes }) {
    return ["img", HTMLAttributes];
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
  Callout,
  FileAttachment,
  Bookmark,
  Image,
];
// Validates the schema builds (fails fast at startup if an extension is incompatible).
getSchema(extensions);

export interface RenderContext {
  docId: string;
  /** lowercased title -> id of a *public* note in the same workspace */
  publicTitles: Map<string, string>;
  /** attachment ids that belong to this note (safe to serve publicly) */
  attachmentIds: Set<string>;
}

/** Walk the JSON tree, calling fn on each node. */
function walk(node: JSONContent, fn: (n: JSONContent) => void): void {
  fn(node);
  node.content?.forEach((c) => walk(c, fn));
}

/** Titles referenced by [[wiki links]] and attachment ids referenced by media — used to build RenderContext. */
export function referencesOf(json: JSONContent): {
  titles: string[];
  attachmentIds: string[];
} {
  const titles = new Set<string>();
  const ids = new Set<string>();
  walk(json, (n) => {
    if (n.type === "wikiLink" && typeof n.attrs?.title === "string")
      titles.add(n.attrs.title);
    if (n.type === "fileAttachment" && typeof n.attrs?.id === "string")
      ids.add(n.attrs.id);
    if (n.type === "image" && typeof n.attrs?.src === "string") {
      const m = n.attrs.src.match(/\/api\/kx\/attachments\/([0-9a-f-]{36})/i);
      if (m) ids.add(m[1]!);
    }
  });
  return { titles: [...titles], attachmentIds: [...ids] };
}

export function stateToJson(state: Uint8Array): JSONContent {
  const doc = new Y.Doc();
  try {
    if (state.byteLength > 0) Y.applyUpdate(doc, state);
    return yXmlFragmentToProsemirrorJSON(
      doc.getXmlFragment("content"),
    ) as JSONContent;
  } finally {
    doc.destroy();
  }
}

const SAFE_ATTACHMENT = (docId: string, id: string) =>
  `/api/public/attachments/${docId}/${id}`;

/**
 * Render a note to sanitised HTML for the public page. Private content never
 * leaks: links to non-public notes become plain text, images/files only resolve
 * for attachments that belong to this note, and the final HTML goes through an
 * allowlist sanitizer (no scripts, event handlers, or javascript: URLs).
 */
export function renderPublicHtml(
  json: JSONContent,
  ctx: RenderContext,
): string {
  // Rewrite media before rendering.
  walk(json, (n) => {
    if (n.type === "image" && n.attrs) {
      const m = String(n.attrs.src ?? "").match(
        /\/api\/kx\/attachments\/([0-9a-f-]{36})/i,
      );
      n.attrs.src =
        m && ctx.attachmentIds.has(m[1]!)
          ? SAFE_ATTACHMENT(ctx.docId, m[1]!)
          : "";
    }
  });
  const raw = generateHTML(
    json.content ? json : { type: "doc", content: [] },
    extensions,
  );

  let html = raw
    // [[Title]] -> link if that note is public, else plain text
    .replace(
      /<span[^>]*data-wiki="([^"]*)"[^>]*>\[\[[^\]]*\]\]<\/span>/g,
      (_m, t: string) => {
        const title = t
          .replace(/&amp;/g, "&")
          .replace(/&quot;/g, '"')
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">");
        const id = ctx.publicTitles.get(title.toLowerCase());
        return id
          ? `<a href="/p/${id}" class="wikilink">${t}</a>`
          : `<span class="wikilink-private">${t}</span>`;
      },
    )
    .replace(
      /<p[^>]*data-file="([0-9a-f-]{36})"[^>]*>📎 ([^<]*)<\/p>/g,
      (_m, id: string, name: string) =>
        ctx.attachmentIds.has(id)
          ? `<p class="file"><a href="${SAFE_ATTACHMENT(ctx.docId, id)}" target="_blank" rel="noopener noreferrer">📎 ${name}</a></p>`
          : `<p class="file">📎 ${name}</p>`,
    );

  html = sanitizeHtml(html, {
    allowedTags: [
      ...sanitizeHtml.defaults.allowedTags,
      "img",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "mark",
      "u",
      "s",
      "input",
      "label",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
      "hr",
      "span",
      "div",
    ],
    allowedAttributes: {
      a: ["href", "target", "rel", "class"],
      img: ["src", "alt", "title"],
      div: ["data-callout", "data-kind"],
      ul: ["data-type"],
      li: ["data-type", "data-checked"],
      input: ["type", "checked", "disabled"],
      p: ["class"],
      span: ["class"],
      td: ["colspan", "rowspan"],
      th: ["colspan", "rowspan"],
      code: ["class"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesByTag: { img: ["https", "http"] },
    allowProtocolRelative: false,
    allowedSchemesAppliedToAttributes: ["href", "src"],
    transformTags: {
      a: (tag, attribs) => {
        const href = attribs.href ?? "";
        const external = /^https?:\/\//i.test(href);
        return {
          tagName: "a",
          attribs: {
            ...attribs,
            ...(external
              ? { target: "_blank", rel: "noopener noreferrer nofollow" }
              : {}),
          },
        };
      },
    },
  });
  return html;
}

/** Plain-text snippet for meta descriptions. */
export function snippetOf(json: JSONContent, max = 160): string {
  let out = "";
  walk(json, (n) => {
    if (n.type === "text" && n.text) out += n.text + " ";
  });
  return out.replace(/\s+/g, " ").trim().slice(0, max);
}
