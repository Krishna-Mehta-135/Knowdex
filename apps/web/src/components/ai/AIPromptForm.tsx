"use client";

import { useState, useRef, useEffect } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import type { InsertPosition } from "@repo/types";
import { Sparkles, XCircle } from "lucide-react";
import type { Editor } from "@tiptap/react";

type InsertMode = "cursor" | "append" | "replace";

interface AIPromptFormProps {
  editor: Editor | null;
  status: "idle" | "writing" | "review" | "done" | "error" | "cancelled";
  onSubmit: (options: {
    prompt: string;
    insertPosition: InsertPosition;
  }) => void;
  onCancel: () => void;
  initialPrompt?: string;
}

export function AIPromptForm({
  editor,
  status,
  onSubmit,
  onCancel,
  initialPrompt = "",
}: AIPromptFormProps) {
  const [prompt, setPrompt] = useState(initialPrompt);
  const [mode, setMode] = useState<InsertMode>("cursor");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isWriting = status === "writing";

  useEffect(() => {
    if (initialPrompt) setPrompt(initialPrompt);
  }, [initialPrompt]);

  // Auto-focus textarea when panel opens
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  function handleSubmit() {
    if (!prompt.trim() || isWriting) return;
    onSubmit({
      prompt: prompt.trim(),
      insertPosition: resolvePosition(mode, editor),
    });
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === "Escape" && isWriting) {
      onCancel();
    }
  }

  const modes: { value: InsertMode; label: string; description: string }[] = [
    {
      value: "cursor",
      label: "At cursor",
      description: "Insert at your current cursor position",
    },
    {
      value: "append",
      label: "At end",
      description: "Append to the end of the document",
    },
    {
      value: "replace",
      label: "Replace",
      description: "Replace your current selection",
    },
  ];

  return (
    <div className="space-y-4">
      {/* Insert mode toggle */}
      <div className="flex rounded-md border border-border overflow-hidden text-[10px] uppercase tracking-wider font-semibold">
        {modes.map((m) => (
          <button
            key={m.value}
            onClick={() => setMode(m.value)}
            title={m.description}
            disabled={isWriting}
            className={`
              flex-1 py-2 transition-colors
              ${
                mode === m.value
                  ? "bg-brand text-white"
                  : "text-muted-foreground hover:bg-surface-hover"
              }
              ${isWriting ? "opacity-50 cursor-not-allowed" : ""}
            `}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Prompt input */}
      <div className="relative">
        <Textarea
          ref={textareaRef}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isWriting}
          placeholder={getPlaceholder(mode)}
          className="min-h-32 resize-none text-sm !bg-[#050505] !text-[#f0f0f0] border-[hsl(var(--sb-border))] focus:border-[hsl(var(--sb-accent))] transition-colors placeholder:text-white/20"
          rows={5}
        />
      </div>

      {/* Actions */}
      {isWriting ? (
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-2 text-[hsl(var(--sb-accent))]">
            <Sparkles className="h-3 w-3 animate-pulse" />
            <span className="text-xs font-medium animate-pulse">
              AI is writing...
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onCancel}
            className="h-8 text-[11px] text-[hsl(var(--sb-danger))] hover:text-[hsl(var(--sb-danger))] hover:bg-[hsl(var(--sb-danger))]/10 gap-1.5"
          >
            <XCircle className="h-3.5 w-3.5" />
            Cancel
          </Button>
        </div>
      ) : (
        <Button
          onClick={handleSubmit}
          disabled={!prompt.trim()}
          className="w-full gap-2 shadow-sm bg-[hsl(var(--sb-accent))] hover:bg-[hsl(var(--sb-accent))]/90 text-white border-none font-bold"
          size="sm"
        >
          <span>Generate Response</span>
          <kbd className="ml-auto pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border border-white/20 bg-white/10 px-1.5 font-mono text-[10px] font-medium text-white/60 opacity-100">
            <span className="text-xs">⌘</span>↵
          </kbd>
        </Button>
      )}
    </div>
  );
}

function getPlaceholder(mode: InsertMode): string {
  if (mode === "cursor")
    return "Write a paragraph about the benefits of async communication...";
  if (mode === "append")
    return "Add a conclusion section summarizing the main points...";
  return "Rewrite this selection to be more professional and concise...";
}

function resolvePosition(
  mode: InsertMode,
  editor: Editor | null,
): InsertPosition {
  if (mode === "append") return { type: "append" };

  if (editor) {
    const { from, to } = editor.state.selection;

    if (mode === "replace") {
      return { type: "replace", startOffset: from, endOffset: to };
    }

    // Default to cursor position
    return { type: "cursor", offset: from };
  }

  // Fallback if editor is not available
  if (mode === "replace")
    return { type: "replace", startOffset: 0, endOffset: 0 };
  return { type: "cursor", offset: 0 };
}
