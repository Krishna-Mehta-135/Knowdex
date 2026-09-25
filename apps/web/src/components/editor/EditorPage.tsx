"use client";

import { useDocument } from "@/lib/sync/useDocument";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import { toast } from "sonner";
import { useEditor } from "@tiptap/react";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCursor from "@tiptap/extension-collaboration-cursor";
import Placeholder from "@tiptap/extension-placeholder";
import CharacterCount from "@tiptap/extension-character-count";
import { Markdown } from "tiptap-markdown";
import { createContentExtensions } from "./extensions/contentExtensions";
import { SlashCommand, type SlashState } from "./slash/SlashCommand";
import { SlashMenu } from "./slash/SlashMenu";
import type { SlashItem } from "./slash/slashItems";
import { linkifyWikiText } from "@/lib/editor/linkifyWiki";
import {
  attachmentUrl,
  FILE_ACCEPT,
  IMAGE_MIME,
  uploadFile,
} from "@/lib/kx/upload";
import { kx } from "@/lib/kx/api";
import * as awarenessProtocol from "y-protocols/awareness";
import * as Y from "yjs";
import { useAuth } from "@/lib/auth/useAuth";
import { User } from "@/lib/auth/types";
import { getCursorColor } from "@/lib/utils/color";

import { EditorContent } from "./EditorContent";
import { EditorSkeleton } from "./EditorSkeleton";
import { CollaboratorBar } from "./CollaboratorBar";
import { WordCount } from "./WordCount";
import { EditorToolbar } from "./EditorToolbar";
import { VersionHistory } from "./VersionHistory";

import { AIPanel } from "@/components/ai/AIPanel";
import { useBacklinks } from "@/lib/documents/useBacklinks";
import { useDocuments } from "@/lib/documents/useDocuments";
import { useRecentDocs } from "@/lib/documents/useRecentDocs";
import { WikiLinkAutocomplete } from "./WikiLinkAutocomplete";

export function EditorPage() {
  const { docId, doc, awareness } = useDocument();
  const auth = useAuth();

  // Only show skeleton if we don't even have a document yet.
  // Awareness can initialize a bit later without forcing a full skeleton flicker.
  if (auth.status !== "authenticated" || !doc) {
    return <EditorSkeleton />;
  }

  return (
    <EditorContentWrapper
      key={docId}
      doc={doc}
      awareness={awareness ?? undefined}
      user={auth.session.user}
    />
  );
}
function EditorContentWrapper({
  doc,
  awareness,
  user,
}: {
  doc: Y.Doc;
  awareness?: awarenessProtocol.Awareness;
  user: User;
}) {
  const { docId } = useDocument();
  const { documents } = useDocuments();
  const { updateLinks } = useBacklinks(docId);
  const { addRecent } = useRecentDocs();
  const linkSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Latest values live in refs so the editor is NOT rebuilt (and the collab
  // binding torn down) every time the documents list or callbacks change.
  const documentsRef = useRef(documents);
  documentsRef.current = documents;
  const updateLinksRef = useRef(updateLinks);
  updateLinksRef.current = updateLinks;
  const editorRef = useRef<Editor | null>(null);

  const [slash, setSlash] = useState<SlashState | null>(null);
  const [urlPrompt, setUrlPrompt] = useState<{
    onSubmit: (u: string) => Promise<void>;
    onCancel: () => void;
  } | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const slashKeyRef = useRef<(e: KeyboardEvent) => boolean>(() => false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Register this document as recently visited
  useEffect(() => {
    if (docId) addRecent(docId);
  }, [docId, addRecent]);

  useEffect(() => {
    return () => {
      if (linkSaveTimerRef.current) clearTimeout(linkSaveTimerRef.current);
    };
  }, []);

  /** Upload files and insert them: images inline, everything else as a file card. */
  const handleFiles = useCallback(
    async (files: File[]) => {
      const ed = editorRef.current;
      if (!ed || files.length === 0) return;
      for (const file of files) {
        const p = uploadFile(docId, file);
        toast.promise(p, {
          loading: `Uploading ${file.name}…`,
          success: `${file.name} added`,
          error: (e: Error) => e.message,
        });
        try {
          const up = await p;
          if (IMAGE_MIME.test(up.mime)) {
            ed.chain()
              .focus()
              .setImage({ src: attachmentUrl(up.id), alt: up.name })
              .run();
          } else {
            ed.chain()
              .focus()
              .setFileAttachment({
                id: up.id,
                name: up.name,
                size: up.size,
                mime: up.mime,
              })
              .run();
          }
        } catch {
          /* toast already shown */
        }
      }
    },
    [docId],
  );
  const handleFilesRef = useRef(handleFiles);
  handleFilesRef.current = handleFiles;

  const runSlashItem = useCallback(
    (item: SlashItem, ed: Editor, range: { from: number; to: number }) => {
      const chain = () => ed.chain().focus().deleteRange(range);
      const a = item.action;
      if (a.type === "upload") {
        chain().run();
        if (fileInputRef.current) {
          fileInputRef.current.accept =
            a.kind === "image" ? "image/*" : FILE_ACCEPT;
          fileInputRef.current.click();
        }
        return;
      }
      if (a.type === "bookmark") {
        chain().run();
        setUrlPrompt({
          onCancel: () => setUrlPrompt(null),
          onSubmit: async (raw) => {
            const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
            let meta: { title?: string; description?: string; image?: string } =
              {};
            try {
              meta = await kx(`link-preview`, {
                method: "POST",
                json: { url },
              });
            } catch {
              toast.error(
                "Couldn't fetch a preview; inserted a plain link card.",
              );
            }
            ed.chain()
              .focus()
              .setBookmark({
                url,
                title: meta.title ?? "",
                description: meta.description ?? "",
                image: meta.image ?? "",
              })
              .run();
            setUrlPrompt(null);
          },
        });
        return;
      }
      switch (a.run) {
        case "paragraph":
          return void chain().setParagraph().run();
        case "h1":
          return void chain().setHeading({ level: 1 }).run();
        case "h2":
          return void chain().setHeading({ level: 2 }).run();
        case "h3":
          return void chain().setHeading({ level: 3 }).run();
        case "bullet":
          return void chain().toggleBulletList().run();
        case "ordered":
          return void chain().toggleOrderedList().run();
        case "todo":
          return void chain().toggleTaskList().run();
        case "quote":
          return void chain().toggleBlockquote().run();
        case "code":
          return void chain().toggleCodeBlock().run();
        case "divider":
          return void chain().setHorizontalRule().run();
        case "table":
          return void chain()
            .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
            .run();
        case "callout-info":
          return void chain().setCallout("info").run();
        case "callout-warning":
          return void chain().setCallout("warning").run();
        case "callout-success":
          return void chain().setCallout("success").run();
        case "callout-danger":
          return void chain().setCallout("danger").run();
        case "wikilink":
          return void chain().insertContent("[[").run();
      }
    },
    [],
  );

  const scheduleLinkSync = useCallback(() => {
    if (linkSaveTimerRef.current) clearTimeout(linkSaveTimerRef.current);
    linkSaveTimerRef.current = setTimeout(() => {
      const ed = editorRef.current;
      if (!ed || ed.isDestroyed) return;
      // Walk the doc only when typing pauses, not on every keystroke.
      const titles = new Set<string>();
      ed.state.doc.descendants((node) => {
        if (
          node.type.name === "wikiLink" &&
          typeof node.attrs.title === "string"
        )
          titles.add(node.attrs.title);
      });
      const ids = Array.from(titles)
        .map(
          (t) =>
            documentsRef.current.find(
              (x) => (x.title ?? "").toLowerCase() === t.toLowerCase(),
            )?.id,
        )
        .filter(Boolean) as string[];
      void updateLinksRef.current(ids).then(() => {
        window.dispatchEvent(
          new CustomEvent("knowdex:backlinks-changed", {
            detail: { toDocIds: ids },
          }),
        );
      });
    }, 450);
  }, []);

  const extensions = useMemo(
    () => [
      ...createContentExtensions(),
      Collaboration.configure({ document: doc, field: "content" }),
      ...(awareness
        ? [
            CollaborationCursor.configure({
              provider: { awareness, document: doc },
              user: {
                name: user.name?.trim() ? user.name : "You",
                color: getCursorColor(user.id),
              },
            }),
          ]
        : []),
      Placeholder.configure({
        placeholder: ({ node }) =>
          node.type.name === "heading"
            ? "Heading..."
            : "Write something, type / for blocks, or press Space to use AI...",
        showOnlyCurrent: true,
      }),
      CharacterCount.configure({ limit: 50000 }),
      Markdown.configure({
        html: false,
        tightLists: true,
        linkify: true,
        transformPastedText: true,
      }),
      SlashCommand.configure({
        onState: setSlash,
        onKey: (e) => slashKeyRef.current(e),
        runItem: runSlashItem,
      }),
    ],
    [doc, awareness, user.id, user.name, runSlashItem],
  );

  const editor = useEditor(
    {
      extensions,
      editorProps: {
        attributes: {
          class:
            "prose prose-invert prose-sm sm:prose-base lg:prose-lg focus:outline-none max-w-none min-h-[500px] text-[15px] leading-relaxed text-[hsl(var(--sb-text))]",
          spellcheck: "true",
        },
        handlePaste: (_view, event) => {
          const files = Array.from(event.clipboardData?.files ?? []);
          if (files.length === 0) return false;
          event.preventDefault();
          void handleFilesRef.current(files);
          return true;
        },
        handleDrop: (_view, event) => {
          const files = Array.from(
            (event as DragEvent).dataTransfer?.files ?? [],
          );
          if (files.length === 0) return false;
          event.preventDefault();
          void handleFilesRef.current(files);
          return true;
        },
      },
      immediatelyRender: false,
      onUpdate: scheduleLinkSync,
    },
    [extensions],
  );
  editorRef.current = editor;

  // Insert [[link]] requests from the Related panel / graph suggestions.
  useEffect(() => {
    function onInsertWiki(e: Event) {
      const title = (e as CustomEvent<{ title?: string }>).detail?.title;
      const ed = editorRef.current;
      if (!ed || !title) return;
      ed.chain()
        .focus("end")
        .insertContent({
          type: "paragraph",
          content: [
            { type: "text", text: "Related: " },
            { type: "wikiLink", attrs: { title } },
          ],
        })
        .run();
    }
    window.addEventListener("knowdex:insert-wikilink", onInsertWiki);
    return () =>
      window.removeEventListener("knowdex:insert-wikilink", onInsertWiki);
  }, []);

  // Imported markdown may contain literal [[Title]]; convert once the content lands.
  useEffect(() => {
    if (!editor) return;
    const key = `knowdex:pending-import:${docId}`;
    let md: string | null = null;
    try {
      md = sessionStorage.getItem(key);
    } catch {
      /* storage unavailable */
    }
    if (!md) return;
    try {
      sessionStorage.removeItem(key);
    } catch {
      /* ignore */
    }
    if (editor.isEmpty) {
      // Node views flushSync; deferring keeps React from warning about it.
      queueMicrotask(() => {
        if (editor.isDestroyed) return;
        editor.commands.setContent(md, { emitUpdate: true });
        linkifyWikiText(editor);
      });
    }
  }, [editor, docId]);

  useEffect(() => {
    if (!editor) return;

    function onExportRequest(e: Event) {
      if (!editor) return;
      const ev = e as CustomEvent<{ docId?: string }>;
      if (ev.detail?.docId && ev.detail.docId !== docId) return;
      try {
        const stor = editor.storage as {
          markdown?: { getMarkdown: () => string };
        };
        const md =
          typeof stor.markdown?.getMarkdown === "function"
            ? stor.markdown.getMarkdown()
            : editor.getText();
        window.dispatchEvent(
          new CustomEvent("knowdex-export-markdown-result", {
            detail: { markdown: md, docId },
          }),
        );
      } catch {
        window.dispatchEvent(
          new CustomEvent("knowdex-export-markdown-result", {
            detail: { markdown: editor.getText(), docId },
          }),
        );
      }
    }

    window.addEventListener(
      "knowdex-export-markdown-request",
      onExportRequest as EventListener,
    );
    return () => {
      window.removeEventListener(
        "knowdex-export-markdown-request",
        onExportRequest as EventListener,
      );
    };
  }, [editor, docId]);

  return (
    <div className="flex flex-col h-full bg-transparent text-[hsl(var(--sb-text))]">
      {/* Toolbar */}
      <EditorToolbar
        editor={editor}
        onOpenHistory={() => setHistoryOpen(true)}
      />

      {/* Editor + AI panel */}
      <div className="flex flex-1 overflow-hidden relative">
        <div className="flex flex-col flex-1 overflow-hidden">
          <EditorContent editor={editor} />
        </div>

        <WikiLinkAutocomplete editor={editor} />
        <SlashMenu
          state={slash}
          urlPrompt={urlPrompt}
          keyHandler={slashKeyRef}
        />
        <input
          ref={fileInputRef}
          type="file"
          hidden
          multiple
          accept={FILE_ACCEPT}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            void handleFiles(files);
          }}
        />

        <AIPanel editor={editor} />
        {historyOpen && (
          <VersionHistory
            docId={docId}
            editor={editor}
            onClose={() => setHistoryOpen(false)}
          />
        )}
      </div>

      {/* Footer info: word count + live collaborators */}
      <div className="h-8 px-4 flex items-center justify-between border-t border-[hsl(var(--sb-border))] bg-[hsl(var(--sb-bg-panel))] shrink-0 sticky bottom-0 z-10">
        <WordCount />
        <CollaboratorBar />
      </div>
    </div>
  );
}
