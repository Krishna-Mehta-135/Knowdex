"use client";
import {
  EditorContent as TiptapEditorContent,
  type Editor,
} from "@tiptap/react";
import { useDocument } from "@/lib/sync/useDocument";
import { EditorTitle } from "./EditorTitle";
import { BacklinksPanel } from "./BacklinksPanel";
import { DocumentTagsBar } from "./DocumentTagsBar";
import { RelatedPanel } from "./RelatedPanel";

interface EditorContentProps {
  editor: Editor | null;
}

export function EditorContent({ editor }: EditorContentProps) {
  const { docId } = useDocument();

  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar relative scroll-smooth">
      <div className="max-w-3xl mx-auto px-4 sm:px-10 py-8 sm:py-16">
        <EditorTitle docId={docId} />

        <DocumentTagsBar docId={docId} />

        <div className="prose prose-invert max-w-none">
          <TiptapEditorContent editor={editor} />
        </div>

        <BacklinksPanel docId={docId} />

        <RelatedPanel docId={docId} />

        <div className="h-32" />
      </div>
    </div>
  );
}
