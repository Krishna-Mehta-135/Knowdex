import { GraphView } from "@/components/graph/GraphView";
import { Network, ArrowLeft } from "lucide-react";
import Link from "next/link";

export default function GraphPage() {
  return (
    <div className="flex-1 flex flex-col h-full bg-[hsl(var(--sb-bg))] text-white">
      <div className="h-12 border-b border-[hsl(var(--sb-border))] flex items-center px-6 shrink-0 bg-[hsl(var(--sb-bg-panel))]/50 gap-4">
        <Link
          href="/documents"
          className="text-[hsl(var(--sb-text-faint))] hover:text-white transition-colors"
          aria-label="Back to documents"
        >
          <ArrowLeft size={16} />
        </Link>
        <Network className="w-4 h-4 mr-2 text-[hsl(var(--sb-accent))]" />
        <h1 className="font-medium text-sm">Knowledge Graph</h1>
      </div>
      <div className="flex-1 min-h-0">
        <GraphView />
      </div>
    </div>
  );
}
