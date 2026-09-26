export type PropType =
  | "text"
  | "number"
  | "select"
  | "multiselect"
  | "date"
  | "checkbox"
  | "url";
export type OptionColor =
  | "gray"
  | "red"
  | "orange"
  | "yellow"
  | "green"
  | "blue"
  | "purple"
  | "pink";

export interface SelectOption {
  id: string;
  name: string;
  color: OptionColor;
}
export interface Property {
  id: string;
  name: string;
  type: PropType;
  options?: SelectOption[];
}
export interface ViewDef {
  id: string;
  name: string;
  type: "table" | "board";
  groupBy?: string;
  sort?: { propId: string; dir: "asc" | "desc" };
  hidden?: string[];
}
export type PropValue = string | number | boolean | string[] | null;
export interface Row {
  id: string;
  title: string;
  props: Record<string, PropValue | undefined>;
  createdAt: number;
  updatedAt: number;
}
export interface DatabaseMeta {
  id: string;
  name: string;
  icon: string;
  workspaceId: string;
  schema: Property[];
  views: ViewDef[];
  rowCount?: number;
}

export const TITLE_ID = "__title";

export const PROP_TYPE_LABELS: Record<PropType, string> = {
  text: "Text",
  number: "Number",
  select: "Select",
  multiselect: "Multi-select",
  date: "Date",
  checkbox: "Checkbox",
  url: "URL",
};

export const OPTION_COLORS: OptionColor[] = [
  "gray",
  "red",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "pink",
];

/** Tailwind classes per option colour (pill background + text). */
export const COLOR_CLASSES: Record<OptionColor, string> = {
  gray: "bg-white/10 text-white/80",
  red: "bg-red-500/20 text-red-200",
  orange: "bg-orange-500/20 text-orange-200",
  yellow: "bg-yellow-500/20 text-yellow-100",
  green: "bg-emerald-500/20 text-emerald-200",
  blue: "bg-sky-500/20 text-sky-200",
  purple: "bg-violet-500/20 text-violet-200",
  pink: "bg-pink-500/20 text-pink-200",
};
