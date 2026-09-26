import {
  TITLE_ID,
  type OptionColor,
  type Property,
  type PropValue,
  type Row,
  type ViewDef,
} from "./types";

function valueOf(row: Row, propId: string): PropValue | undefined {
  return propId === TITLE_ID ? row.title : row.props[propId];
}

const isEmpty = (v: PropValue | undefined) =>
  v === null ||
  v === undefined ||
  v === "" ||
  (Array.isArray(v) && v.length === 0);

function compare(
  prop: Property | null,
  a: PropValue | undefined,
  b: PropValue | undefined,
): number {
  if (prop?.type === "select") {
    // Sort selects by their option order, not alphabetically.
    const order = new Map((prop.options ?? []).map((o, i) => [o.id, i]));
    return (order.get(String(a)) ?? 1e9) - (order.get(String(b)) ?? 1e9);
  }
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean")
    return Number(a) - Number(b);
  const sa = Array.isArray(a) ? a.join(",") : String(a ?? "");
  const sb = Array.isArray(b) ? b.join(",") : String(b ?? "");
  return sa.localeCompare(sb, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

/** Stable sort; empty values always sink to the bottom regardless of direction. */
export function sortRows(
  rows: Row[],
  schema: Property[],
  sort: ViewDef["sort"],
): Row[] {
  if (!sort) return rows;
  const prop = schema.find((p) => p.id === sort.propId) ?? null;
  if (!prop && sort.propId !== TITLE_ID) return rows;
  const dir = sort.dir === "desc" ? -1 : 1;
  return rows
    .map((r, i) => ({ r, i }))
    .sort((x, y) => {
      const a = valueOf(x.r, sort.propId);
      const b = valueOf(y.r, sort.propId);
      const ea = isEmpty(a);
      const eb = isEmpty(b);
      if (ea || eb) return ea === eb ? x.i - y.i : ea ? 1 : -1;
      return compare(prop, a, b) * dir || x.i - y.i;
    })
    .map((x) => x.r);
}

export interface Filters {
  query: string;
  /** propId -> option id (select) to require. */
  select: Record<string, string>;
}

function searchText(row: Row, schema: Property[]): string {
  const parts = [row.title];
  for (const p of schema) {
    const v = row.props[p.id];
    if (isEmpty(v)) continue;
    if (p.type === "select")
      parts.push(p.options?.find((o) => o.id === v)?.name ?? "");
    else if (p.type === "multiselect") {
      for (const id of v as string[])
        parts.push(p.options?.find((o) => o.id === id)?.name ?? "");
    } else if (p.type !== "checkbox") parts.push(String(v));
  }
  return parts.join(" ").toLowerCase();
}

export function filterRows(rows: Row[], schema: Property[], f: Filters): Row[] {
  const q = f.query.trim().toLowerCase();
  const sel = Object.entries(f.select).filter(([, v]) => v);
  if (!q && sel.length === 0) return rows;
  return rows.filter((r) => {
    for (const [propId, optId] of sel) {
      const v = r.props[propId];
      const ok = Array.isArray(v)
        ? v.includes(optId)
        : optId === "__none"
          ? isEmpty(v)
          : v === optId;
      if (!ok) return false;
    }
    return !q || searchText(r, schema).includes(q);
  });
}

export interface Group {
  /** Option id, or null for rows without a value. */
  key: string | null;
  name: string;
  color: OptionColor;
  rows: Row[];
}

/** Kanban columns: one per option (in option order, even if empty) plus "No value". */
export function groupRows(rows: Row[], prop: Property): Group[] {
  const groups: Group[] = (prop.options ?? []).map((o) => ({
    key: o.id,
    name: o.name,
    color: o.color,
    rows: [],
  }));
  const byKey = new Map(groups.map((g) => [g.key, g]));
  const none: Group = { key: null, name: "No value", color: "gray", rows: [] };
  for (const r of rows) {
    const v = r.props[prop.id];
    const g = typeof v === "string" ? byKey.get(v) : undefined;
    (g ?? none).rows.push(r);
  }
  return none.rows.length > 0 ? [none, ...groups] : groups;
}

export function slugify(name: string, taken: Set<string>): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 30) || "prop";
  let id = base;
  for (let i = 2; taken.has(id); i++) id = `${base}-${i}`;
  return id;
}

/** Board views need a select property to group by. */
export function firstSelectProp(schema: Property[]): Property | undefined {
  return schema.find((p) => p.type === "select");
}
