"use client";

import { useParams, useRouter } from "next/navigation";
import { ForceGraph } from "@/components/graph/ForceGraph";
import { useGraphData } from "@/lib/graph/useGraphData";

/** Local graph for the right panel: the open note plus its neighbours. */
export function MiniPhysicsGraph() {
  const router = useRouter();
  const params = useParams();
  const currentDocId = (params?.docId as string | undefined) ?? null;
  const { data, loading } = useGraphData(60_000);

  if (!loading && data.nodes.length === 0) {
    return (
      <p className="text-xs text-[hsl(var(--sb-text-faint))] italic p-2">
        Link notes with [[wiki links]] to grow your graph.
      </p>
    );
  }

  return (
    <ForceGraph
      mini
      data={data}
      activeId={currentDocId}
      onOpen={(n) =>
        router.push(
          `/documents/${n.kind === "file" ? (n.parentId ?? n.id) : n.id}`,
        )
      }
    />
  );
}
