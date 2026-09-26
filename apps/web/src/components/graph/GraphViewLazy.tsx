"use client";

import dynamic from "next/dynamic";

/** The graph (canvas engine, timeline, suggestions) is only needed on /graph. */
export const GraphViewLazy = dynamic(
  () => import("./GraphView").then((m) => m.GraphView),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center text-sm text-[hsl(var(--sb-text-muted))]">
        Loading graph…
      </div>
    ),
  },
);
