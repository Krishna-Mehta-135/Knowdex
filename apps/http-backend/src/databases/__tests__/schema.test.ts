import { describe, expect, it } from "vitest";
import {
  coerceValue,
  schemaArray,
  TEMPLATES,
  validateProps,
  viewsArray,
  type Property,
} from "../schema.js";

const schema: Property[] = [
  {
    id: "status",
    name: "Status",
    type: "select",
    options: [
      { id: "a", name: "A", color: "gray" },
      { id: "b", name: "B", color: "red" },
    ],
  },
  {
    id: "tags",
    name: "Tags",
    type: "multiselect",
    options: [
      { id: "x", name: "X", color: "gray" },
      { id: "y", name: "Y", color: "gray" },
    ],
  },
  { id: "due", name: "Due", type: "date" },
  { id: "n", name: "N", type: "number" },
  { id: "ok", name: "OK", type: "checkbox" },
  { id: "u", name: "U", type: "url" },
  { id: "t", name: "T", type: "text" },
];
const p = (id: string) => schema.find((s) => s.id === id)!;

describe("coerceValue", () => {
  it("accepts valid values per type", () => {
    expect(coerceValue(p("status"), "a")).toBe("a");
    expect(coerceValue(p("tags"), ["x", "y"])).toEqual(["x", "y"]);
    expect(coerceValue(p("due"), "2026-02-28")).toBe("2026-02-28");
    expect(coerceValue(p("n"), 3.5)).toBe(3.5);
    expect(coerceValue(p("ok"), false)).toBe(false);
    expect(coerceValue(p("u"), "https://a.io/x")).toBe("https://a.io/x");
    expect(coerceValue(p("t"), "hi")).toBe("hi");
  });
  it("dedupes repeated multiselect values", () => {
    expect(coerceValue(p("tags"), ["x", "x", "y"])).toEqual(["x", "y"]);
  });
  it("treats null/empty as clearing", () => {
    for (const s of schema) expect(coerceValue(s, null)).toBeNull();
    expect(coerceValue(p("t"), "")).toBeNull();
  });
  it("rejects invalid values", () => {
    expect(coerceValue(p("status"), "zzz")).toBeUndefined();
    expect(coerceValue(p("tags"), ["x", "nope"])).toBeUndefined();
    expect(coerceValue(p("due"), "2026-02-30")).toBeUndefined(); // impossible date
    expect(coerceValue(p("due"), "tomorrow")).toBeUndefined();
    expect(coerceValue(p("n"), Infinity)).toBeUndefined();
    expect(coerceValue(p("n"), "5")).toBeUndefined();
    expect(coerceValue(p("ok"), "true")).toBeUndefined();
    expect(coerceValue(p("u"), "javascript:alert(1)")).toBeUndefined();
    expect(coerceValue(p("t"), 5)).toBeUndefined();
  });
});

describe("validateProps", () => {
  it("collects cleaned values and errors, rejecting unknown ids", () => {
    const r = validateProps(schema, {
      status: "a",
      due: "bad",
      ghost: 1,
      n: null,
    });
    expect(r.ok).toBe(false);
    expect(r.value).toEqual({ status: "a", n: null });
    expect(r.errors).toHaveLength(2);
  });
  it("ok for an empty patch", () => {
    expect(validateProps(schema, {})).toMatchObject({ ok: true, value: {} });
  });
});

describe("schema validation", () => {
  it("rejects duplicate ids and select without options", () => {
    expect(
      schemaArray.safeParse([
        { id: "a", name: "A", type: "text" },
        { id: "a", name: "B", type: "text" },
      ]).success,
    ).toBe(false);
    expect(
      schemaArray.safeParse([{ id: "s", name: "S", type: "select" }]).success,
    ).toBe(false);
    expect(
      schemaArray.safeParse([{ id: "bad id!", name: "S", type: "text" }])
        .success,
    ).toBe(false);
  });
  it("built-in templates are valid", () => {
    for (const t of Object.values(TEMPLATES)) {
      expect(schemaArray.safeParse(t.schema).success).toBe(true);
      expect(viewsArray.safeParse(t.views).success).toBe(true);
    }
  });
});
