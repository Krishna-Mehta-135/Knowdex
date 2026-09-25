"use client";

import { useState, useCallback } from "react";
import { AIPromptForm } from "./AIPromptForm";
import { AIStatusBar } from "./AIStatusBar";
import { AIHistory, addToHistory } from "./AIHistory";
import { useAIWriter } from "./hooks/useAIWriter";
import { AILiveBanner } from "./AILiveBanner";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { X, History, Wand2 } from "lucide-react";
import type { InsertPosition } from "@repo/types";
import type { Editor } from "@tiptap/react";

interface AIPanelProps {
  editor: Editor | null;
}

export function AIPanel({ editor }: AIPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [reusePrompt, setReusePrompt] = useState<string | undefined>(undefined);
  const {
    status,
    error,
    pending,
    reviewMode,
    setReviewMode,
    startWriting,
    cancelWriting,
    accept,
    discard,
    reset,
  } = useAIWriter();

  const banner = (
    <AILiveBanner
      writing={status === "writing"}
      pending={pending}
      onStop={cancelWriting}
      onAccept={accept}
      onDiscard={discard}
    />
  );

  const handleSubmit = useCallback(
    async (options: { prompt: string; insertPosition: InsertPosition }) => {
      addToHistory(options.prompt);
      try {
        await startWriting({ ...options, editor });
      } catch (err) {
        console.error("AI Writing failed:", err);
      }
    },
    [startWriting, editor],
  );

  if (!isOpen) {
    return (
      <>
        {banner}
        <Button
          variant="outline"
          size="lg"
          onClick={() => setIsOpen(true)}
          className="fixed bottom-6 right-6 shadow-xl gap-2 bg-[hsl(var(--sb-bg-panel))] hover:bg-[hsl(var(--sb-bg-hover))] border border-[hsl(var(--sb-border))] text-[hsl(var(--sb-text))] rounded-full h-12 px-6 z-50 font-medium transition-all hover:border-[hsl(var(--sb-accent))] hover:text-[hsl(var(--sb-accent))]"
        >
          <Wand2 className="h-5 w-5" />
          AI Assistant
        </Button>
      </>
    );
  }

  return (
    <>
      {banner}
      {/* Mobile overlay backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 lg:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}
      {/* Mobile panel container */}
      <div className="fixed inset-y-0 right-0 w-[92vw] max-w-[400px] h-full flex flex-col bg-[hsl(var(--sb-bg-panel))] shadow-2xl animate-in slide-in-from-right duration-300 z-50 lg:relative lg:w-80 lg:max-w-none lg:shadow-lg lg:animate-none lg:border-l lg:border-[hsl(var(--sb-border))] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-5 border-b border-[hsl(var(--sb-border))] bg-[hsl(var(--sb-bg-panel))]/80 backdrop-blur-md sticky top-0 z-20 shrink-0">
          <div className="flex items-center gap-3">
            <div className="bg-[hsl(var(--sb-accent))]/15 p-2 rounded-xl shadow-[0_0_15px_-3px_hsla(var(--sb-accent-glow)/0.4)]">
              <Wand2 className="h-4.5 w-4.5 text-[hsl(var(--sb-accent))]" />
            </div>
            <div>
              <h3 className="font-bold text-sm tracking-tight text-[hsl(var(--sb-text))]">
                AI Assistant
              </h3>
              <div className="flex items-center gap-1.5 mt-1">
                <span className="flex h-1.5 w-1.5 rounded-full bg-[hsl(var(--sb-success))]" />
                <span className="text-[10px] text-[hsl(var(--sb-text-faint))] font-medium uppercase tracking-wider">
                  Ready to help
                </span>
              </div>
            </div>
          </div>
          <button
            onClick={() => setIsOpen(false)}
            className="p-1.5 rounded-lg hover:bg-[hsl(var(--sb-bg-hover))] text-[hsl(var(--sb-text-faint))] hover:text-white transition-all"
            aria-label="Close AI panel"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-hidden relative">
          <ScrollArea className="h-full w-full">
            <div className="p-4 space-y-6 pb-20 lg:pb-6">
              {/* Prompt Form Section */}
              <div className="space-y-3">
                <AIPromptForm
                  editor={editor}
                  status={status}
                  onSubmit={handleSubmit}
                  onCancel={cancelWriting}
                  initialPrompt={reusePrompt}
                />

                <label className="flex cursor-pointer items-center gap-2 text-[11px] text-[hsl(var(--sb-text-muted))]">
                  <input
                    type="checkbox"
                    checked={reviewMode}
                    onChange={(e) => setReviewMode(e.target.checked)}
                    className="accent-[hsl(var(--sb-accent))]"
                  />
                  Review before inserting
                </label>

                {error && (
                  <div className="flex gap-2 p-3 text-[11px] text-[hsl(var(--sb-danger))] bg-[hsl(var(--sb-danger))]/5 rounded-lg border border-[hsl(var(--sb-danger))]/10">
                    <div className="shrink-0 mt-0.5">⚠️</div>
                    <div>{error}</div>
                  </div>
                )}

                {(status === "done" || status === "cancelled") && (
                  <div className="flex items-center justify-center gap-2 py-2">
                    <span className="text-[11px] text-[hsl(var(--sb-text-muted))]">
                      {status === "done"
                        ? "✓ Finished writing"
                        : "↩ Generation stopped"}
                    </span>
                    <button
                      onClick={() => {
                        reset();
                        setReusePrompt(undefined);
                      }}
                      className="text-[11px] text-[hsl(var(--sb-accent))] hover:underline font-medium"
                    >
                      Start over
                    </button>
                  </div>
                )}
              </div>

              <Separator className="opacity-50 bg-[hsl(var(--sb-border))]" />

              {/* History Section */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-white px-1">
                  <History className="h-3.5 w-3.5" />
                  <span className="text-xs font-bold uppercase tracking-wider">
                    Session History
                  </span>
                </div>
                <AIHistory
                  onReuse={(prompt) => {
                    setReusePrompt(prompt);
                    reset();
                  }}
                />
              </div>
            </div>
          </ScrollArea>
        </div>

        {/* Footer / Status Bar */}
        <div className="p-3 border-t border-[hsl(var(--sb-border))] bg-[hsl(var(--sb-bg-panel))]/30 shrink-0">
          <AIStatusBar status={status} />
        </div>
      </div>
    </>
  );
}
