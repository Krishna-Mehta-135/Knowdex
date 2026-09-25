"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { kx, type GraphData } from "@/lib/kx/api";
import { useWorkspace } from "@/lib/workspaces/WorkspaceProvider";

const EMPTY: GraphData = { nodes: [], edges: [], ghostEdges: [] };

/** Real workspace graph (links + ghost links). Polls lightly so new index results appear. */
export function useGraphData(pollMs = 30_000) {
  const { activeWorkspaceId } = useWorkspace();
  const [data, setData] = useState<GraphData>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const lastKey = useRef("");

  const load = useCallback(async () => {
    if (!activeWorkspaceId) return;
    try {
      const d = await kx<GraphData>(`workspaces/${activeWorkspaceId}/graph`);
      // Skip state updates (and the re-layout they trigger) when nothing changed.
      const key = JSON.stringify([
        d.nodes.map((n) => [n.id, n.title, n.degree]),
        d.edges,
        d.ghostEdges.map((g) => [g.a, g.b]),
      ]);
      if (key !== lastKey.current) {
        lastKey.current = key;
        setData(d);
      }
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [activeWorkspaceId]);

  useEffect(() => {
    lastKey.current = "";
    setData(EMPTY);
    setLoading(true);
    void load();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, pollMs);
    return () => clearInterval(id);
  }, [load, pollMs]);

  return { data, loading, error, reload: load };
}
