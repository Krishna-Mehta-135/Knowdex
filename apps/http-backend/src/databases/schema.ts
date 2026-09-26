import { z } from "zod";

export const PROP_TYPES = [
  "text",
  "number",
  "select",
  "multiselect",
  "date",
  "checkbox",
  "url",
] as const;
export type PropType = (typeof PROP_TYPES)[number];

const id = z.string().regex(/^[a-z0-9_-]{1,40}$/i, "invalid id");
const color = z.enum([
  "gray",
  "red",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "pink",
]);

export const optionSchema = z.object({
  id,
  name: z.string().trim().min(1).max(60),
  color: color.default("gray"),
});

export const propertySchema = z.object({
  id,
  name: z.string().trim().min(1).max(60),
  type: z.enum(PROP_TYPES),
  options: z.array(optionSchema).max(50).optional(),
});

export const viewSchema = z.object({
  id,
  name: z.string().trim().min(1).max(60),
  type: z.enum(["table", "board"]),
  /** Board: the select property whose options become columns. */
  groupBy: id.optional(),
  sort: z
    .object({ propId: z.string().max(40), dir: z.enum(["asc", "desc"]) })
    .optional(),
  hidden: z.array(id).max(50).optional(),
});

export const schemaArray = z
  .array(propertySchema)
  .max(50)
  .superRefine((props, ctx) => {
    const seen = new Set<string>();
    props.forEach((p, i) => {
      if (seen.has(p.id))
        ctx.addIssue({
          code: "custom",
          message: `duplicate property id ${p.id}`,
          path: [i, "id"],
        });
      seen.add(p.id);
      if ((p.type === "select" || p.type === "multiselect") && !p.options) {
        ctx.addIssue({
          code: "custom",
          message: "select properties need options",
          path: [i, "options"],
        });
      }
    });
  });

export const viewsArray = z.array(viewSchema).min(1).max(20);

export type Property = z.infer<typeof propertySchema>;
export type View = z.infer<typeof viewSchema>;
export type PropValue = string | number | boolean | string[] | null;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Coerce one raw value to the property's type. Returns undefined when invalid. */
export function coerceValue(p: Property, raw: unknown): PropValue | undefined {
  if (raw === null || raw === undefined || raw === "") return null;
  switch (p.type) {
    case "text":
      return typeof raw === "string" ? raw.slice(0, 2000) : undefined;
    case "number":
      return typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
    case "checkbox":
      return typeof raw === "boolean" ? raw : undefined;
    case "date": {
      if (typeof raw !== "string" || !ISO_DATE.test(raw)) return undefined;
      const d = new Date(`${raw}T00:00:00Z`);
      return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== raw
        ? undefined
        : raw;
    }
    case "url":
      return typeof raw === "string" &&
        raw.length <= 2000 &&
        /^https?:\/\//i.test(raw)
        ? raw
        : undefined;
    case "select":
      return typeof raw === "string" && p.options?.some((o) => o.id === raw)
        ? raw
        : undefined;
    case "multiselect": {
      if (!Array.isArray(raw) || raw.length > 50) return undefined;
      const ids = new Set(p.options?.map((o) => o.id));
      const out = [...new Set(raw)].filter(
        (v): v is string => typeof v === "string",
      );
      return out.length === new Set(raw).size && out.every((v) => ids.has(v))
        ? out
        : undefined;
    }
  }
}

export interface PropsResult {
  ok: boolean;
  value: Record<string, PropValue>;
  errors: string[];
}

/**
 * Validate a partial props patch against the schema. Unknown property ids are
 * rejected (typos shouldn't silently vanish); null clears a value.
 */
export function validateProps(
  schema: Property[],
  patch: Record<string, unknown>,
): PropsResult {
  const byId = new Map(schema.map((p) => [p.id, p]));
  const value: Record<string, PropValue> = {};
  const errors: string[] = [];
  for (const [key, raw] of Object.entries(patch)) {
    const p = byId.get(key);
    if (!p) {
      errors.push(`unknown property "${key}"`);
      continue;
    }
    const v = coerceValue(p, raw);
    if (v === undefined)
      errors.push(`invalid value for "${p.name}" (${p.type})`);
    else value[key] = v;
  }
  return { ok: errors.length === 0, value, errors };
}

export const TEMPLATES: Record<string, { schema: Property[]; views: View[] }> =
  {
    blank: {
      schema: [{ id: "tags", name: "Tags", type: "multiselect", options: [] }],
      views: [{ id: "table", name: "Table", type: "table" }],
    },
    tasks: {
      schema: [
        {
          id: "status",
          name: "Status",
          type: "select",
          options: [
            { id: "todo", name: "To do", color: "gray" },
            { id: "doing", name: "In progress", color: "blue" },
            { id: "done", name: "Done", color: "green" },
          ],
        },
        { id: "due", name: "Due", type: "date" },
        {
          id: "priority",
          name: "Priority",
          type: "select",
          options: [
            { id: "low", name: "Low", color: "gray" },
            { id: "med", name: "Medium", color: "yellow" },
            { id: "high", name: "High", color: "red" },
          ],
        },
        { id: "tags", name: "Tags", type: "multiselect", options: [] },
      ],
      views: [
        { id: "table", name: "Table", type: "table" },
        { id: "board", name: "Board", type: "board", groupBy: "status" },
      ],
    },
    reading: {
      schema: [
        {
          id: "status",
          name: "Status",
          type: "select",
          options: [
            { id: "queue", name: "Queue", color: "gray" },
            { id: "reading", name: "Reading", color: "purple" },
            { id: "finished", name: "Finished", color: "green" },
          ],
        },
        { id: "author", name: "Author", type: "text" },
        { id: "link", name: "Link", type: "url" },
        { id: "rating", name: "Rating", type: "number" },
      ],
      views: [
        { id: "table", name: "Table", type: "table" },
        { id: "board", name: "Board", type: "board", groupBy: "status" },
      ],
    },
  };
