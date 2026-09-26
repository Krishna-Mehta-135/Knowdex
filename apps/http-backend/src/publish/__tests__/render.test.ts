import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import type { JSONContent } from "@tiptap/core";
import {
  referencesOf,
  renderPublicHtml,
  snippetOf,
  stateToJson,
} from "../render.js";

const ID = "11111111-1111-1111-1111-111111111111";
const ID2 = "22222222-2222-2222-2222-222222222222";
const ctx = (over: Partial<Parameters<typeof renderPublicHtml>[1]> = {}) => ({
  docId: "doc-1",
  publicTitles: new Map<string, string>(),
  attachmentIds: new Set<string>(),
  ...over,
});
const p = (...content: JSONContent[]): JSONContent => ({
  type: "doc",
  content: [{ type: "paragraph", content }],
});
const text = (t: string, marks?: JSONContent["marks"]): JSONContent => ({
  type: "text",
  text: t,
  marks,
});

describe("renderPublicHtml", () => {
  it("renders headings, marks, lists and callouts", () => {
    const html = renderPublicHtml(
      {
        type: "doc",
        content: [
          { type: "heading", attrs: { level: 2 }, content: [text("Title")] },
          { type: "paragraph", content: [text("bold", [{ type: "bold" }])] },
          {
            type: "bulletList",
            content: [
              {
                type: "listItem",
                content: [{ type: "paragraph", content: [text("item")] }],
              },
            ],
          },
          {
            type: "callout",
            attrs: { kind: "warning" },
            content: [{ type: "paragraph", content: [text("careful")] }],
          },
        ],
      },
      ctx(),
    );
    expect(html).toContain("<h2>Title</h2>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<li>");
    expect(html).toContain("data-callout");
    expect(html).toContain('data-kind="warning"');
  });

  it("links public wiki notes and hides private ones", () => {
    const html = renderPublicHtml(
      p({ type: "wikiLink", attrs: { title: "Public Note" } }, text(" "), {
        type: "wikiLink",
        attrs: { title: "Secret" },
      }),
      ctx({ publicTitles: new Map([["public note", ID]]) }),
    );
    expect(html).toContain(`<a href="/p/${ID}"`);
    expect(html).toContain("wikilink-private");
    expect(html).not.toContain("/p/undefined");
  });

  it("only serves images/files that belong to the note", () => {
    const ok = renderPublicHtml(
      {
        type: "doc",
        content: [
          {
            type: "image",
            attrs: { src: `/api/kx/attachments/${ID}`, alt: "a" },
          },
          { type: "fileAttachment", attrs: { id: ID2, name: "doc.pdf" } },
        ],
      },
      ctx({ attachmentIds: new Set([ID, ID2]) }),
    );
    expect(ok).toContain(`src="/api/public/attachments/doc-1/${ID}"`);
    expect(ok).toContain(`href="/api/public/attachments/doc-1/${ID2}"`);
    const foreign = renderPublicHtml(
      {
        type: "doc",
        content: [
          { type: "image", attrs: { src: `/api/kx/attachments/${ID}` } },
          { type: "fileAttachment", attrs: { id: ID2, name: "x.pdf" } },
        ],
      },
      ctx(),
    );
    expect(foreign).not.toContain("/api/public/attachments");
    expect(foreign).not.toContain("/api/kx/");
  });

  it("strips scripts, event handlers and javascript: URLs", () => {
    const html = renderPublicHtml(
      p(
        text("click", [
          { type: "link", attrs: { href: "javascript:alert(1)" } },
        ]),
        text(" <script>alert(1)</script> "),
        text("ok", [{ type: "link", attrs: { href: "https://example.com" } }]),
      ),
      ctx(),
    );
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
  });

  it("handles empty docs", () => {
    expect(renderPublicHtml({ type: "doc" }, ctx())).toBe("");
  });
});

describe("helpers", () => {
  it("referencesOf collects wiki titles and attachment ids", () => {
    const r = referencesOf({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "wikiLink", attrs: { title: "A" } }],
        },
        { type: "fileAttachment", attrs: { id: ID } },
        { type: "image", attrs: { src: `/api/kx/attachments/${ID2}` } },
      ],
    });
    expect(r.titles).toEqual(["A"]);
    expect(r.attachmentIds.sort()).toEqual([ID, ID2]);
  });

  it("stateToJson + snippetOf round trip from a Y state", () => {
    const doc = new Y.Doc();
    const el = new Y.XmlElement("paragraph");
    const t = new Y.XmlText();
    t.insert(0, "Hello public world");
    el.insert(0, [t]);
    doc.getXmlFragment("content").push([el]);
    const json = stateToJson(Y.encodeStateAsUpdate(doc));
    expect(snippetOf(json)).toBe("Hello public world");
    expect(snippetOf(json, 5)).toBe("Hello");
    expect(stateToJson(new Uint8Array())).toMatchObject({ type: "doc" });
  });
});
