"use client";

import { useEffect, useState } from "react";
import type { Awareness } from "y-protocols/awareness";
import type { UserPresence } from "./awareness";

export interface AISession {
  clientId: number;
  requestedBy: string;
  text: string;
  isSelf: boolean;
}

/** Live AI writing sessions of every collaborator (including this user). */
export function useAIPresence(awareness: Awareness | null): AISession[] {
  const [sessions, setSessions] = useState<AISession[]>([]);

  useEffect(() => {
    if (!awareness) return;
    const read = () => {
      const now = Date.now();
      const list: AISession[] = [];
      awareness.getStates().forEach((state, clientId) => {
        const ai = (state as UserPresence | undefined)?.ai;
        // Ignore sessions whose owner stopped updating (tab closed mid-stream).
        if (ai && now - ai.at < 20_000) {
          list.push({
            clientId,
            requestedBy: ai.requestedBy,
            text: ai.text,
            isSelf: clientId === awareness.clientID,
          });
        }
      });
      setSessions((prev) => {
        const same =
          prev.length === list.length &&
          prev.every(
            (p, i) =>
              p.clientId === list[i]!.clientId && p.text === list[i]!.text,
          );
        return same ? prev : list;
      });
    };
    awareness.on("change", read);
    awareness.on("update", read);
    read();
    const t = setInterval(read, 5_000);
    return () => {
      awareness.off("change", read);
      awareness.off("update", read);
      clearInterval(t);
    };
  }, [awareness]);

  return sessions;
}
