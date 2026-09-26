"use client";

import { useRouter } from "next/navigation";
import { ForceGraph } from "@/components/graph/ForceGraph";
import { useGraphData } from "@/lib/graph/useGraphData";

/** Non-interactive-looking graph teaser for Home (the whole card links to /graph). */
export function GraphPreview() {
  const { data, loading } = useGraphData(120_000);
  const router = useRouter();
  if (!loading && data.nodes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-xs text-[hsl(var(--sb-text-faint))]">
        Link notes with [[wiki links]] to grow your graph.
      </div>
    );
  }
  return <ForceGraph mini data={data} onOpen={() => router.push("/graph")} />;
}
