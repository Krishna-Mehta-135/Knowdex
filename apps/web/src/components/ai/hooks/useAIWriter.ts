"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useSyncManager } from "@/lib/sync/SyncContext";
import { useDocument } from "@/lib/sync/useDocument";
import { useAuth } from "@/lib/auth/useAuth";
import { linkifyWikiText } from "@/lib/editor/linkifyWiki";
import type { InsertPosition, WSMessage } from "@repo/types";
import type { Editor } from "@tiptap/react";

export type AIStatus =
  | "idle"
  | "writing"
  | "review"
  | "done"
  | "error"
  | "cancelled";

interface WriteOptions {
  prompt: string;
  insertPosition: InsertPosition;
  editor: Editor | null;
}

/** Where the result goes, kept in sync with concurrent edits while streaming. */
interface Target {
  type: InsertPosition["type"];
  from: number;
  to: number;
}

export interface PendingSuggestion {
  markdown: string;
  target: Target;
}

const REVIEW_KEY = "knowdex:ai-review-mode";
const LIVE_TAIL_CHARS = 700;
const LIVE_THROTTLE_MS = 120;

function readReviewPref(): boolean {
  try {
    return localStorage.getItem(REVIEW_KEY) !== "off";
  } catch {
    return true;
  }
}

/**
 * Manages the AI writing flow.
 *
 * The server streams raw Markdown tokens. While they arrive we (a) show them
 * live to the requester and, via awareness, to every collaborator, and (b)
 * accumulate them. On completion the Markdown is inserted through the Tiptap
 * editor (so headings, lists and bold survive) — immediately, or after the user
 * accepts it when "review before inserting" is on. The insertion point is mapped
 * through every transaction that happens while the AI writes, so concurrent
 * edits by collaborators never shift the result to the wrong place.
 */
export function useAIWriter() {
  const manager = useSyncManager();
  const { awareness } = useDocument();
  const auth = useAuth();
  const userName =
    auth.status === "authenticated"
      ? auth.session.user.name || "Someone"
      : "Someone";

  const [status, setStatus] = useState<AIStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [liveText, setLiveText] = useState("");
  const [pending, setPending] = useState<PendingSuggestion | null>(null);
  const [reviewMode, setReviewModeState] = useState(true);

  const currentRequestId = useRef<string | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const accumulatedText = useRef("");
  const liveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const awarenessRef = useRef(awareness);
  awarenessRef.current = awareness;

  useEffect(() => setReviewModeState(readReviewPref()), []);

  const setReviewMode = useCallback((on: boolean) => {
    setReviewModeState(on);
    try {
      localStorage.setItem(REVIEW_KEY, on ? "on" : "off");
    } catch {
      /* preference just isn't remembered */
    }
  }, []);

  const publish = useCallback(
    (text: string | null) => {
      awarenessRef.current?.setLocalStateField(
        "ai",
        text === null
          ? null
          : {
              requestedBy: userName,
              text: text.slice(-LIVE_TAIL_CHARS),
              at: Date.now(),
            },
      );
    },
    [userName],
  );

  const scheduleLive = useCallback(() => {
    if (liveTimer.current) return;
    liveTimer.current = setTimeout(() => {
      liveTimer.current = null;
      setLiveText(accumulatedText.current.slice(-LIVE_TAIL_CHARS));
      publish(accumulatedText.current);
    }, LIVE_THROTTLE_MS);
  }, [publish]);

  const clearLive = useCallback(() => {
    if (liveTimer.current) clearTimeout(liveTimer.current);
    liveTimer.current = null;
    setLiveText("");
    publish(null);
  }, [publish]);

  const startWriting = useCallback(
    async (options: WriteOptions): Promise<void> => {
      // Cancel any in-progress request before starting new one
      if (currentRequestId.current) {
        manager.send({
          type: "ai-cancel",
          requestId: currentRequestId.current,
        });
      }
      cleanupRef.current?.();

      accumulatedText.current = "";
      setPending(null);
      const editor = options.editor;
      editorRef.current = editor;

      const ip = options.insertPosition;
      const target: Target =
        ip.type === "replace"
          ? { type: "replace", from: ip.startOffset, to: ip.endOffset }
          : ip.type === "cursor"
            ? { type: "cursor", from: ip.offset, to: ip.offset }
            : { type: "append", from: 0, to: 0 };

      const onTx = ({
        transaction,
      }: {
        transaction: {
          docChanged: boolean;
          mapping: { map: (p: number, a?: number) => number };
        };
      }) => {
        if (!transaction.docChanged) return;
        target.from = transaction.mapping.map(target.from, -1);
        target.to = transaction.mapping.map(target.to, 1);
      };
      editor?.on("transaction", onTx);

      const requestId = manager.sendAIRequest(
        options.prompt,
        options.insertPosition,
      );
      currentRequestId.current = requestId;
      setStatus("writing");
      setError(null);
      publish("");

      return new Promise<void>((resolve, reject) => {
        const finish = () => {
          editor?.off("transaction", onTx);
          unsubUpdate();
          unsubError();
          cleanupRef.current = null;
          currentRequestId.current = null;
        };

        const unsubUpdate = manager.onMessage("ai-update", (msg: WSMessage) => {
          if (msg.type !== "ai-update" || msg.requestId !== requestId) return;

          if (!msg.isDone) {
            accumulatedText.current += msg.text;
            scheduleLive();
            return;
          }

          finish();
          const markdown = accumulatedText.current;
          accumulatedText.current = "";
          clearLive();

          if (!markdown.trim() || !editor) {
            setStatus("done");
          } else if (readReviewPref()) {
            setPending({ markdown, target });
            setStatus("review");
          } else {
            insertMarkdown(editor, markdown, target);
            setStatus("done");
          }
          resolve();
        });

        const unsubError = manager.onMessage("error", (msg: WSMessage) => {
          if (msg.type !== "error") return;
          finish();
          accumulatedText.current = "";
          clearLive();
          setStatus("error");
          setError(msg.message);
          reject(new Error(msg.message));
        });

        cleanupRef.current = () => {
          editor?.off("transaction", onTx);
          unsubUpdate();
          unsubError();
        };
      });
    },
    [manager, publish, scheduleLive, clearLive],
  );

  const accept = useCallback(() => {
    const ed = editorRef.current;
    if (pending && ed) insertMarkdown(ed, pending.markdown, pending.target);
    setPending(null);
    setStatus("done");
  }, [pending]);

  const discard = useCallback(() => {
    setPending(null);
    setStatus("idle");
  }, []);

  const cancelWriting = useCallback(() => {
    if (!currentRequestId.current) return;
    manager.send({ type: "ai-cancel", requestId: currentRequestId.current });
    cleanupRef.current?.();
    cleanupRef.current = null;
    currentRequestId.current = null;
    accumulatedText.current = "";
    clearLive();
    setStatus("cancelled");
  }, [manager, clearLive]);

  const reset = useCallback(() => {
    setStatus("idle");
    setError(null);
    setPending(null);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (currentRequestId.current) {
        manager.send({
          type: "ai-cancel",
          requestId: currentRequestId.current,
        });
      }
      cleanupRef.current?.();
      if (liveTimer.current) clearTimeout(liveTimer.current);
      awarenessRef.current?.setLocalStateField("ai", null);
    };
  }, [manager]);

  return {
    status,
    error,
    liveText,
    pending,
    reviewMode,
    setReviewMode,
    startWriting,
    cancelWriting,
    accept,
    discard,
    reset,
  };
}

/** Insert Markdown at the (mapped) target; `[[Title]]` text becomes real links. */
function insertMarkdown(
  editor: Editor,
  markdown: string,
  target: Target,
): void {
  const size = editor.state.doc.content.size;
  const clamp = (n: number) => Math.max(0, Math.min(size, n));
  const opts = { parseOptions: { preserveWhitespace: false as const } };

  if (target.type === "replace") {
    const from = clamp(target.from);
    const to = Math.max(from, clamp(target.to));
    editor
      .chain()
      .focus()
      .deleteRange({ from, to })
      .insertContentAt(from, markdown, opts)
      .run();
  } else if (target.type === "append") {
    editor.chain().focus().insertContentAt(size, markdown, opts).run();
  } else {
    editor
      .chain()
      .focus()
      .insertContentAt(clamp(target.from), markdown, opts)
      .run();
  }
  linkifyWikiText(editor);
}
