import { mergeAttributes, Node } from "@tiptap/core";
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import { useState } from "react";
import { ExternalLink, FileText, Maximize2, Minimize2 } from "lucide-react";
import { attachmentUrl, formatBytes } from "@/lib/kx/upload";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    fileAttachment: {
      setFileAttachment: (a: {
        id: string;
        name: string;
        size: number;
        mime: string;
      }) => ReturnType;
    };
  }
}

function FileCard({ node, selected }: NodeViewProps) {
  const { id, name, size, mime } = node.attrs as {
    id: string;
    name: string;
    size: number;
    mime: string;
  };
  const [open, setOpen] = useState(false);
  const isPdf = mime === "application/pdf";
  const url = attachmentUrl(id);
  return (
    <NodeViewWrapper className="my-4" contentEditable={false}>
      <div
        className={`overflow-hidden rounded-xl border bg-[hsl(var(--sb-bg-panel))] ${selected ? "border-[hsl(var(--sb-accent))]" : "border-[hsl(var(--sb-border))]"}`}
      >
        <div className="flex items-center gap-3 px-4 py-3">
          <FileText size={20} className="shrink-0 text-amber-400" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-white">
              {name}
            </div>
            <div className="text-xs text-[hsl(var(--sb-text-muted))]">
              {isPdf ? "PDF" : "File"} · {formatBytes(size)} · searchable in Ask
            </div>
          </div>
          {isPdf && (
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-label={open ? "Collapse preview" : "Expand preview"}
              className="rounded-md p-1.5 text-[hsl(var(--sb-text-muted))] hover:bg-[hsl(var(--sb-bg-hover))]"
            >
              {open ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            </button>
          )}
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Open in new tab"
            className="rounded-md p-1.5 text-[hsl(var(--sb-text-muted))] hover:bg-[hsl(var(--sb-bg-hover))]"
          >
            <ExternalLink size={15} />
          </a>
        </div>
        {open && isPdf && (
          <iframe
            src={url}
            title={name}
            className="h-[560px] w-full border-t border-[hsl(var(--sb-border))] bg-white"
          />
        )}
      </div>
    </NodeViewWrapper>
  );
}

/** Block card for an uploaded PDF or other file (the bytes live server-side). */
export const FileAttachment = Node.create({
  name: "fileAttachment",
  group: "block",
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      id: { default: "" },
      name: { default: "file" },
      size: { default: 0 },
      mime: { default: "application/pdf" },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-file-attachment]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-file-attachment": "" }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(FileCard);
  },

  addCommands() {
    return {
      setFileAttachment:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },

  addStorage() {
    return {
      markdown: {
        serialize(
          state: {
            write: (s: string) => void;
            closeBlock: (n: unknown) => void;
          },
          node: { attrs: { id: string; name: string } },
        ) {
          state.write(
            `[📎 ${node.attrs.name}](${attachmentUrl(node.attrs.id)})`,
          );
          state.closeBlock(node);
        },
        parse: {},
      },
    };
  },
});
