import { Suspense } from "react";
import { Sparkles } from "lucide-react";
import { AskView } from "@/components/ask/AskView";

export default function AskPage() {
  return (
    <div className="flex h-full flex-1 flex-col bg-[hsl(var(--sb-bg))] text-white">
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-[hsl(var(--sb-border))] bg-[hsl(var(--sb-bg-panel))]/50 px-6">
        <Sparkles className="h-4 w-4 text-[hsl(var(--sb-accent))]" />
        <h1 className="text-sm font-medium">Ask your notes</h1>
      </div>
      <div className="min-h-0 flex-1">
        <Suspense>
          <AskView />
        </Suspense>
      </div>
    </div>
  );
}
