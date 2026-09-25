import { describe, expect, it } from "vitest";
import {
  convertMarkdown,
  folderFromPath,
  jsonToYState,
  titleFromPath,
} from "../convert.js";
import { extractPlainText } from "../../semantic/text.js";

describe("paths", () => {
  it("strips Notion hashes and extensions", () => {
    expect(
      titleFromPath("Projects/Roadmap 1a2b3c4d5e6f47a8b9c0d1e2f3a4b5c6.md"),
    ).toBe("Roadmap");
    expect(titleFromPath("plain.markdown")).toBe("plain");
    expect(
      folderFromPath("Space 0123456789abcdef0123456789abcdef/Notes/x.md"),
    ).toBe("Space / Notes");
    expect(folderFromPath("x.md")).toBe("");
  });
});

describe("convertMarkdown", () => {
  it("parses frontmatter title + tags (list and inline forms)", () => {
    const a = convertMarkdown(
      "---\ntitle: My Title\ntags: [alpha, beta]\n---\nBody",
      "f.md",
    );
    expect(a.title).toBe("My Title");
    expect(a.tags).toEqual(["alpha", "beta"]);
    const b = convertMarkdown(
      "---\ntags:\n  - one\n  - #two\n---\nBody",
      "f.md",
    );
    expect(b.tags).toEqual(["one", "two"]);
    expect(b.title).toBe("f");
  });

  it("turns [[links]] (with alias/heading), embeds and Notion links into wiki links", () => {
    const r = convertMarkdown(
      "See [[Alpha]], [[Beta|the beta]], [[Gamma#Sec]] and ![[pic.png]] plus [Delta](Delta%20aabbccddeeff00112233445566778899.md) and [web](https://x.io).",
      "Note.md",
    );
    expect(r.links.sort()).toEqual(["Alpha", "Beta", "Delta", "Gamma"]);
    const json = JSON.stringify(r.json);
    expect(json).toContain('"type":"wikiLink"');
    expect(json).toContain("https://x.io");
    expect(json).toContain("embedded: pic.png");
  });

  it("does not rewrite [[x]] inside code", () => {
    const r = convertMarkdown(
      "Text\n\n```\n[[NotALink]]\n```\n\nand `[[Inline]]`",
      "n.md",
    );
    expect(r.links).toEqual([]);
  });

  it("ignores self links", () => {
    expect(convertMarkdown("[[Me]]", "Me.md").links).toEqual([]);
  });

  it("converts checkbox lists to task lists and regular lists stay lists", () => {
    const t = JSON.stringify(convertMarkdown("- [ ] a\n- [x] b", "t.md").json);
    expect(t).toContain('"type":"taskList"');
    expect(t).toContain('"checked":true');
    const l = JSON.stringify(convertMarkdown("- a\n- b", "t.md").json);
    expect(l).toContain('"type":"bulletList"');
    expect(l).not.toContain("taskList");
  });

  it("supports headings, tables and formatting", () => {
    const j = JSON.stringify(
      convertMarkdown(
        "# H\n\n**b** *i*\n\n| a | b |\n|---|---|\n| 1 | 2 |\n",
        "t.md",
      ).json,
    );
    expect(j).toContain('"type":"heading"');
    expect(j).toContain('"type":"table"');
    expect(j).toContain('"bold"');
  });

  it("round-trips through Y state into indexable plain text", () => {
    const r = convertMarkdown(
      "# Title\n\nHello **world** with [[Other]].\n\n- one\n- two",
      "t.md",
    );
    const text = extractPlainText(jsonToYState(r.json));
    expect(text).toContain("Hello world");
    expect(text).toContain("Other");
    expect(text).toContain("one");
  });

  it("handles empty input", () => {
    const r = convertMarkdown("", "empty.md");
    expect(r.title).toBe("empty");
    expect(() => jsonToYState(r.json)).not.toThrow();
  });
});
