import { Extension, type Editor, type Range } from "@tiptap/core";
import Suggestion, { type SuggestionProps } from "@tiptap/suggestion";
import { PluginKey } from "@tiptap/pm/state";
import { SLASH_ITEMS, type SlashItem } from "./slashItems";

export interface SlashState {
  items: SlashItem[];
  query: string;
  rect: (() => DOMRect | null) | null;
  select: (item: SlashItem) => void;
}

export interface SlashOptions {
  /** Called whenever the menu opens/updates (state) or closes (null). */
  onState: (s: SlashState | null) => void;
  /** Return true if the menu consumed the key. */
  onKey: (e: KeyboardEvent) => boolean;
  runItem: (item: SlashItem, editor: Editor, range: Range) => void;
}

export function filterSlashItems(query: string): SlashItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return SLASH_ITEMS;
  return SLASH_ITEMS.filter(
    (i) =>
      i.title.toLowerCase().includes(q) ||
      i.keywords.some((k) => k.includes(q)),
  );
}

export const SlashCommand = Extension.create<SlashOptions>({
  name: "slashCommand",

  addOptions() {
    return { onState: () => {}, onKey: () => false, runItem: () => {} };
  },

  addProseMirrorPlugins() {
    const opts = this.options;
    return [
      Suggestion<SlashItem, SlashItem>({
        editor: this.editor,
        pluginKey: new PluginKey("slashCommand"),
        char: "/",
        allowSpaces: false,
        startOfLine: false,
        // Don't trigger inside URLs / paths like "a/b".
        allowedPrefixes: [" "],
        items: ({ query }) => filterSlashItems(query),
        command: ({ editor, range, props }) =>
          opts.runItem(props, editor, range),
        render: () => {
          // The plugin re-invokes onUpdate on every view update, including the
          // ones React re-renders trigger (Tiptap's setOptions). Only publish
          // when something visible changed, otherwise setState loops forever.
          let key = "";
          let latest: SuggestionProps<SlashItem, SlashItem> | null = null;
          const stable: Pick<SlashState, "rect" | "select"> = {
            rect: () => latest?.clientRect?.() ?? null,
            select: (item) => latest?.command(item),
          };
          const push = (p: SuggestionProps<SlashItem, SlashItem>) => {
            latest = p;
            const next = `${p.query}|${p.items.map((i) => i.id).join(",")}|${p.range.from}`;
            if (next === key) return;
            key = next;
            opts.onState({ items: p.items, query: p.query, ...stable });
          };
          return {
            onStart: push,
            onUpdate: push,
            onKeyDown: ({ event }) => opts.onKey(event),
            onExit: () => {
              key = "";
              latest = null;
              opts.onState(null);
            },
          };
        },
      }),
    ];
  },
});
