import { mergeAttributes, Node } from "@tiptap/core";
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import { Globe } from "lucide-react";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    bookmark: {
      setBookmark: (a: {
        url: string;
        title?: string;
        description?: string;
        image?: string;
      }) => ReturnType;
    };
  }
}

const safeHttp = (u: string) => /^https?:\/\//i.test(u);

function BookmarkCard({ node, selected }: NodeViewProps) {
  const { url, title, description, image } = node.attrs as {
    url: string;
    title: string;
    description: string;
    image: string;
  };
  let host = url;
  try {
    host = new URL(url).hostname;
  } catch {
    /* keep raw */
  }
  return (
    <NodeViewWrapper className="my-4" contentEditable={false}>
      <a
        href={safeHttp(url) ? url : undefined}
        target="_blank"
        rel="noopener noreferrer"
        className={`flex overflow-hidden rounded-xl border bg-[hsl(var(--sb-bg-panel))] no-underline hover:bg-[hsl(var(--sb-bg-hover))] ${selected ? "border-[hsl(var(--sb-accent))]" : "border-[hsl(var(--sb-border))]"}`}
      >
        <div className="min-w-0 flex-1 px-4 py-3">
          <div className="truncate text-sm font-medium text-white">
            {title || host}
          </div>
          {description && (
            <div className="mt-1 line-clamp-2 text-xs text-[hsl(var(--sb-text-muted))]">
              {description}
            </div>
          )}
          <div className="mt-2 flex items-center gap-1.5 text-xs text-[hsl(var(--sb-text-faint))]">
            <Globe size={12} /> {host}
          </div>
        </div>
        {image && safeHttp(image) && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={image}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            className="hidden h-auto w-40 object-cover sm:block"
          />
        )}
      </a>
    </NodeViewWrapper>
  );
}

export const Bookmark = Node.create({
  name: "bookmark",
  group: "block",
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      url: { default: "" },
      title: { default: "" },
      description: { default: "" },
      image: { default: "" },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-bookmark]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-bookmark": "" })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(BookmarkCard);
  },

  addCommands() {
    return {
      setBookmark:
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
          node: { attrs: { url: string; title: string } },
        ) {
          state.write(
            `[${node.attrs.title || node.attrs.url}](${node.attrs.url})`,
          );
          state.closeBlock(node);
        },
        parse: {},
      },
    };
  },
});
