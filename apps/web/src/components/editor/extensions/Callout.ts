import { mergeAttributes, Node } from "@tiptap/core";

export type CalloutKind = "info" | "warning" | "success" | "danger";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    callout: {
      setCallout: (kind?: CalloutKind) => ReturnType;
    };
  }
}

/** Highlighted block, exported to Markdown as an Obsidian-style `> [!info]` quote. */
export const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,

  addAttributes() {
    return {
      kind: {
        default: "info",
        parseHTML: (el) => el.getAttribute("data-kind") ?? "info",
        renderHTML: (attrs) => ({ "data-kind": attrs.kind as string }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-callout]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-callout": "" }), 0];
  },

  addCommands() {
    return {
      setCallout:
        (kind = "info") =>
        ({ commands }) =>
          commands.wrapIn(this.name, { kind }),
    };
  },

  addStorage() {
    return {
      markdown: {
        serialize(
          state: {
            write: (s: string) => void;
            wrapBlock: (
              d: string,
              f: string | null,
              n: unknown,
              fn: () => void,
            ) => void;
            renderContent: (n: unknown) => void;
          },
          node: { attrs: { kind: string } },
        ) {
          state.write(`> [!${node.attrs.kind}]\n`);
          state.wrapBlock("> ", null, node, () => state.renderContent(node));
        },
        parse: {},
      },
    };
  },
});
