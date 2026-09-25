export type SlashAction =
  | {
      type: "chain";
      run:
        | "paragraph"
        | "h1"
        | "h2"
        | "h3"
        | "bullet"
        | "ordered"
        | "todo"
        | "quote"
        | "code"
        | "divider"
        | "table"
        | "callout-info"
        | "callout-warning"
        | "callout-success"
        | "callout-danger"
        | "wikilink";
    }
  | { type: "upload"; kind: "image" | "file" }
  | { type: "bookmark" };

export interface SlashItem {
  id: string;
  title: string;
  description: string;
  keywords: string[];
  group: "Basic" | "Media" | "Advanced";
  action: SlashAction;
}

export const SLASH_ITEMS: SlashItem[] = [
  {
    id: "text",
    title: "Text",
    description: "Plain paragraph",
    keywords: ["paragraph", "p"],
    group: "Basic",
    action: { type: "chain", run: "paragraph" },
  },
  {
    id: "h1",
    title: "Heading 1",
    description: "Big section heading",
    keywords: ["h1", "title"],
    group: "Basic",
    action: { type: "chain", run: "h1" },
  },
  {
    id: "h2",
    title: "Heading 2",
    description: "Medium heading",
    keywords: ["h2", "subtitle"],
    group: "Basic",
    action: { type: "chain", run: "h2" },
  },
  {
    id: "h3",
    title: "Heading 3",
    description: "Small heading",
    keywords: ["h3"],
    group: "Basic",
    action: { type: "chain", run: "h3" },
  },
  {
    id: "bullet",
    title: "Bulleted list",
    description: "Simple list",
    keywords: ["ul", "list"],
    group: "Basic",
    action: { type: "chain", run: "bullet" },
  },
  {
    id: "ordered",
    title: "Numbered list",
    description: "Ordered list",
    keywords: ["ol", "list"],
    group: "Basic",
    action: { type: "chain", run: "ordered" },
  },
  {
    id: "todo",
    title: "To-do list",
    description: "Track tasks with checkboxes",
    keywords: ["task", "checkbox"],
    group: "Basic",
    action: { type: "chain", run: "todo" },
  },
  {
    id: "quote",
    title: "Quote",
    description: "Highlight a quotation",
    keywords: ["blockquote"],
    group: "Basic",
    action: { type: "chain", run: "quote" },
  },
  {
    id: "code",
    title: "Code block",
    description: "Monospaced code",
    keywords: ["snippet", "pre"],
    group: "Basic",
    action: { type: "chain", run: "code" },
  },
  {
    id: "divider",
    title: "Divider",
    description: "Horizontal rule",
    keywords: ["hr", "line", "separator"],
    group: "Basic",
    action: { type: "chain", run: "divider" },
  },
  {
    id: "table",
    title: "Table",
    description: "3 × 3 table",
    keywords: ["grid", "database"],
    group: "Advanced",
    action: { type: "chain", run: "table" },
  },
  {
    id: "callout",
    title: "Callout",
    description: "Highlighted info box",
    keywords: ["info", "note", "alert"],
    group: "Advanced",
    action: { type: "chain", run: "callout-info" },
  },
  {
    id: "callout-warning",
    title: "Warning callout",
    description: "Draw attention to a risk",
    keywords: ["warn", "caution"],
    group: "Advanced",
    action: { type: "chain", run: "callout-warning" },
  },
  {
    id: "callout-success",
    title: "Success callout",
    description: "Positive highlight",
    keywords: ["tip", "done"],
    group: "Advanced",
    action: { type: "chain", run: "callout-success" },
  },
  {
    id: "wikilink",
    title: "Link to note",
    description: "Insert a [[wiki link]]",
    keywords: ["link", "backlink", "reference"],
    group: "Advanced",
    action: { type: "chain", run: "wikilink" },
  },
  {
    id: "image",
    title: "Image",
    description: "Upload an image",
    keywords: ["picture", "photo", "upload"],
    group: "Media",
    action: { type: "upload", kind: "image" },
  },
  {
    id: "pdf",
    title: "PDF / file",
    description: "Upload a PDF — searchable with Ask",
    keywords: ["document", "attachment", "upload", "file"],
    group: "Media",
    action: { type: "upload", kind: "file" },
  },
  {
    id: "bookmark",
    title: "Web bookmark",
    description: "Paste a URL for a preview card",
    keywords: ["url", "link", "embed"],
    group: "Media",
    action: { type: "bookmark" },
  },
];
