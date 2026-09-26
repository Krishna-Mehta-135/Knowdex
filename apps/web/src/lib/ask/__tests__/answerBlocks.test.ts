import { describe, expect, it } from "vitest";
import { parseAnswer, parseInline } from "../answerBlocks";

describe("parseInline", () => {
  it("splits bold, code and citations", () => {
    expect(parseInline("A **b** and `c` see [1][12]")).toEqual([
      { t: "text", v: "A " },
      { t: "bold", v: "b" },
      { t: "text", v: " and " },
      { t: "code", v: "c" },
      { t: "text", v: " see " },
      { t: "cite", n: 1 },
      { t: "cite", n: 12 },
    ]);
  });
  it("keeps unclosed markers literal (mid-stream) and never emits HTML", () => {
    expect(parseInline("half **bold")).toEqual([
      { t: "text", v: "half **bold" },
    ]);
    expect(parseInline("<script>x</script>")).toEqual([
      { t: "text", v: "<script>x</script>" },
    ]);
    expect(parseInline("")).toEqual([]);
  });
  it("only treats 1-2 digit brackets as citations", () => {
    expect(parseInline("[123] [a] [3]")).toEqual([
      { t: "text", v: "[123] [a] " },
      { t: "cite", n: 3 },
    ]);
  });
});

describe("parseAnswer", () => {
  it("builds paragraphs, bullet and numbered lists, headings", () => {
    const b = parseAnswer(
      "# Title\n\nFirst line\nsecond line\n\n- one\n* two\n\n1. a\n2) b\n\nEnd",
    );
    expect(b.map((x) => x.t)).toEqual(["h", "p", "ul", "ol", "p"]);
    expect(b[1]).toMatchObject({
      inline: [{ t: "text", v: "First line second line" }],
    });
    expect((b[2] as { items: unknown[] }).items).toHaveLength(2);
    expect((b[3] as { items: unknown[] }).items).toHaveLength(2);
  });
  it("switches list kinds and handles CRLF / empty input", () => {
    expect(parseAnswer("- a\r\n1. b").map((x) => x.t)).toEqual(["ul", "ol"]);
    expect(parseAnswer("")).toEqual([]);
  });
});
