"use client";

import { Sparkles, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { AIStatus } from "./hooks/useAIWriter";

interface AIStatusBarProps {
  status: AIStatus;
}

export function AIStatusBar({ status }: AIStatusBarProps) {
  if (status === "idle") return null;

  return (
    <div
      className={`
      flex items-center gap-2 px-3 py-2 rounded-md text-xs font-medium border
      ${status === "writing" ? "bg-brand/5 text-brand border-brand/20" : ""}
      ${
        status === "done"
          ? "bg-green-500/5 text-green-600 border-green-500/20"
          : ""
      }
      ${
        status === "error"
          ? "bg-destructive/5 text-destructive border-destructive/20"
          : ""
      }
      ${status === "cancelled" ? "bg-muted text-muted-foreground border-muted" : ""}
    `}
    >
      {status === "writing" && (
        <>
          <Loader2 className="h-3 w-3 animate-spin" />
          <span>AI is generating content...</span>
        </>
      )}
      {status === "review" && (
        <>
          <Sparkles className="h-3 w-3" />
          <span>Suggestion ready — review it</span>
        </>
      )}
      {status === "done" && (
        <>
          <CheckCircle2 className="h-3 w-3" />
          <span>Generation complete</span>
        </>
      )}
      {status === "error" && (
        <>
          <AlertTriangle className="h-3 w-3" />
          <span>Something went wrong</span>
        </>
      )}
      {status === "cancelled" && (
        <>
          <Sparkles className="h-3 w-3" />
          <span>Generation cancelled</span>
        </>
      )}
    </div>
  );
}
