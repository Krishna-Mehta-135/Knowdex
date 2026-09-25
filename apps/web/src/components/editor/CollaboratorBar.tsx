"use client";
import { useDocument } from "@/lib/sync/useDocument";
import { useEffect, useState, useCallback } from "react";
import type { UserPresence } from "@/lib/sync/awareness";
import { useAIPresence } from "@/lib/sync/useAIPresence";
import { Sparkles } from "lucide-react";

export function CollaboratorBar() {
  const { awareness } = useDocument();
  const [collaborators, setCollaborators] = useState<UserPresence[]>([]);
  const aiSessions = useAIPresence(awareness);

  const updateCollaborators = useCallback(() => {
    if (!awareness) return;

    const states = awareness.getStates();
    const now = Date.now();
    const list: UserPresence[] = [];

    states.forEach((state: unknown) => {
      if (!state) return;
      const presence = state as UserPresence;

      // Filter by active in last 30s
      if (presence.userId && now - (presence.lastSeen || 0) < 30_000) {
        // Prevent duplicate keys if the same user joins from multiple devices/tabs
        if (!list.find((u) => u.userId === presence.userId)) {
          list.push(presence);
        }
      }
    });

    setCollaborators(list.sort((a, b) => a.name.localeCompare(b.name)));
  }, [awareness]);

  useEffect(() => {
    if (!awareness) return;

    awareness.on("change", updateCollaborators);
    updateCollaborators();

    const timer = setInterval(updateCollaborators, 10_000);

    return () => {
      awareness.off("change", updateCollaborators);
      clearInterval(timer);
    };
  }, [awareness, updateCollaborators]);

  return (
    <div className="flex -space-x-2 overflow-hidden">
      {aiSessions.length > 0 && (
        <div
          className="inline-flex h-7 w-7 shrink-0 animate-pulse items-center justify-center rounded-full bg-fuchsia-500 text-white shadow-sm ring-2 ring-[hsl(var(--sb-bg-panel))]"
          title={`Knowdex AI is writing for ${aiSessions[0]!.requestedBy}`}
        >
          <Sparkles size={13} />
        </div>
      )}
      {collaborators.map((c) => (
        <div
          key={c.userId}
          className="inline-flex items-center justify-center h-7 w-7 rounded-full ring-2 ring-[hsl(var(--sb-bg-panel))] text-[10px] font-bold text-white uppercase shadow-sm shrink-0"
          style={{ backgroundColor: c.color }}
          title={c.name}
        >
          {c.name.charAt(0)}
        </div>
      ))}
    </div>
  );
}
