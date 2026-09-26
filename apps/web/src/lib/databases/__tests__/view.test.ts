import { describe, expect, it } from "vitest";
import {
  filterRows,
  firstSelectProp,
  groupRows,
  slugify,
  sortRows,
} from "../view";
import type { Property, Row } from "../types";

const status: Property = {
  id: "status",
  name: "Status",
  type: "select",
  options: [
    { id: "todo", name: "To do", color: "gray" },
    { id: "doing", name: "Doing", color: "blue" },
    { id: "done", name: "Done", color: "green" },
  ],
};
const tags: Property = {
  id: "tags",
  name: "Tags",
  type: "multiselect",
  options: [
    { id: "a", name: "Alpha", color: "red" },
    { id: "b", name: "Beta", color: "red" },
  ],
};
const n: Property = { id: "n", name: "N", type: "number" };
const schema = [status, tags, n];
const row = (id: string, title: string, props: Row["props"] = {}): Row => ({
  id,
  title,
  props,
  createdAt: 0,
  updatedAt: 0,
});
const rows = [
  row("1", "Banana", { status: "done", n: 10, tags: ["a"] }),
  row("2", "apple", { status: "todo", n: 2 }),
  row("3", "Cherry", { n: 33, tags: ["a", "b"] }),
  row("4", "date", { status: "doing" }),
];
const ids = (r: Row[]) => r.map((x) => x.id);

describe("sortRows", () => {
  it("sorts titles case-insensitively, both directions", () => {
    expect(
      ids(sortRows(rows, schema, { propId: "__title", dir: "asc" })),
    ).toEqual(["2", "1", "3", "4"]);
    expect(
      ids(sortRows(rows, schema, { propId: "__title", dir: "desc" })),
    ).toEqual(["4", "3", "1", "2"]);
  });
  it("sorts numbers numerically and keeps empty values last in both directions", () => {
    expect(ids(sortRows(rows, schema, { propId: "n", dir: "asc" }))).toEqual([
      "2",
      "1",
      "3",
      "4",
    ]);
    expect(ids(sortRows(rows, schema, { propId: "n", dir: "desc" }))).toEqual([
      "3",
      "1",
      "2",
      "4",
    ]);
  });
  it("sorts selects by option order, not alphabetically", () => {
    expect(
      ids(sortRows(rows, schema, { propId: "status", dir: "asc" })),
    ).toEqual(["2", "4", "1", "3"]);
  });
  it("is stable, does not mutate, and ignores unknown/absent sort", () => {
    expect(sortRows(rows, schema, undefined)).toBe(rows);
    expect(sortRows(rows, schema, { propId: "ghost", dir: "asc" })).toBe(rows);
    const copy = [...rows];
    sortRows(rows, schema, { propId: "n", dir: "asc" });
    expect(rows).toEqual(copy);
  });
});

describe("filterRows", () => {
  it("matches title, option names and values", () => {
    expect(ids(filterRows(rows, schema, { query: "APP", select: {} }))).toEqual(
      ["2"],
    );
    expect(
      ids(filterRows(rows, schema, { query: "doing", select: {} })),
    ).toEqual(["4"]);
    expect(
      ids(filterRows(rows, schema, { query: "beta", select: {} })),
    ).toEqual(["3"]);
    expect(ids(filterRows(rows, schema, { query: "33", select: {} }))).toEqual([
      "3",
    ]);
  });
  it("applies select filters incl. multiselect membership and 'none'", () => {
    expect(
      ids(filterRows(rows, schema, { query: "", select: { status: "done" } })),
    ).toEqual(["1"]);
    expect(
      ids(filterRows(rows, schema, { query: "", select: { tags: "a" } })),
    ).toEqual(["1", "3"]);
    expect(
      ids(
        filterRows(rows, schema, { query: "", select: { status: "__none" } }),
      ),
    ).toEqual(["3"]);
    expect(
      ids(filterRows(rows, schema, { query: "c", select: { tags: "a" } })),
    ).toEqual(["3"]);
  });
  it("returns the same array when there is nothing to filter", () => {
    expect(
      filterRows(rows, schema, { query: " ", select: { status: "" } }),
    ).toBe(rows);
  });
});

describe("groupRows", () => {
  it("makes a column per option in order plus 'No value' first when needed", () => {
    const g = groupRows(rows, status);
    expect(g.map((x) => x.name)).toEqual([
      "No value",
      "To do",
      "Doing",
      "Done",
    ]);
    expect(g.map((x) => ids(x.rows))).toEqual([["3"], ["2"], ["4"], ["1"]]);
  });
  it("keeps empty option columns and omits 'No value' when unused", () => {
    const g = groupRows([row("x", "X", { status: "done" })], status);
    expect(g.map((x) => x.name)).toEqual(["To do", "Doing", "Done"]);
    expect(g[0]!.rows).toEqual([]);
  });
  it("puts unknown option ids into 'No value'", () => {
    const g = groupRows([row("x", "X", { status: "removed-option" })], status);
    expect(g[0]).toMatchObject({ key: null, name: "No value" });
  });
});

describe("helpers", () => {
  it("slugify makes unique ids", () => {
    expect(slugify("Due Date!", new Set())).toBe("due-date");
    expect(slugify("Due Date", new Set(["due-date"]))).toBe("due-date-2");
    expect(slugify("???", new Set())).toBe("prop");
  });
  it("finds the first select property", () => {
    expect(firstSelectProp(schema)?.id).toBe("status");
    expect(firstSelectProp([n])).toBeUndefined();
  });
});
