import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Link from "@tiptap/extension-link";
import Highlight from "@tiptap/extension-highlight";
import Image from "@tiptap/extension-image";
import {
  Table,
  TableRow,
  TableCell,
  TableHeader,
} from "@tiptap/extension-table";
import { WikiLink } from "./WikiLink";
import { Callout } from "./Callout";
import { FileAttachment } from "./PdfAttachment";
import { Bookmark } from "./Bookmark";

/**
 * The document schema (nodes + marks) shared by the live editor and read-only
 * views such as version-history previews, so both always render identically.
 */
export function createContentExtensions() {
  return [
    StarterKit.configure({
      undoRedo: false, // Yjs provides undo/redo
      link: false, // configured below
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Link.configure({
      openOnClick: false,
      HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
    }),
    WikiLink,
    Callout,
    FileAttachment,
    Bookmark,
    Highlight,
    Image.configure({ allowBase64: false }),
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
  ];
}
