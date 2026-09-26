"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { WorkspaceRecord } from "@repo/types";
import { useAuth } from "@/lib/auth/useAuth";

const STORAGE_KEY = "knowdex:activeWorkspaceId";

type MembershipRow = { workspace: WorkspaceRecord; role: string };

interface WorkspaceContextValue {
  memberships: MembershipRow[];
  activeWorkspaceId: string | null;
  setActiveWorkspaceId: (id: string | null) => void;
  isLoading: boolean;
  bootstrap: () => Promise<void>;
  refresh: () => Promise<void>;
  activeWorkspace: WorkspaceRecord | null;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  const [memberships, setMemberships] = useState<MembershipRow[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceIdState] = useState<
    string | null
  >(null);
  const [isLoading, setIsLoading] = useState(true);
  const userId = auth.status === "authenticated" ? auth.session.user.id : null;

  const setActiveWorkspaceId = useCallback((id: string | null) => {
    setActiveWorkspaceIdState(id);
    if (typeof window !== "undefined") {
      if (id) localStorage.setItem(STORAGE_KEY, id);
      else localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const load = useCallback(async () => {
    if (auth.status !== "authenticated") {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      let rows: MembershipRow[] = [];

      const cacheKey = userId ? `knowdex:memberships:v1:${userId}` : null;
      const readCache = (): MembershipRow[] => {
        try {
          const raw = cacheKey ? localStorage.getItem(cacheKey) : null;
          const parsed: unknown = raw ? JSON.parse(raw) : [];
          return Array.isArray(parsed) ? (parsed as MembershipRow[]) : [];
        } catch {
          return [];
        }
      };

      let reachedServer = true;
      try {
        const boot = await fetch("/api/workspaces/bootstrap", {
          method: "POST",
          credentials: "include",
        });
        const bootJson = await boot.json().catch(() => ({}));

        if (boot.ok && Array.isArray(bootJson?.data)) {
          rows = bootJson.data as MembershipRow[];
        } else if (!boot.ok && boot.status !== 401) {
          const fallback = await fetch("/api/workspaces", {
            credentials: "include",
          });
          const fbJson = await fallback.json().catch(() => ({}));
          if (fallback.ok && Array.isArray(fbJson?.data)) {
            rows = fbJson.data as MembershipRow[];
          } else if (fallback.status >= 500) {
            reachedServer = false;
          }
        }
      } catch {
        // Offline or server down: fall back to the last known memberships.
        reachedServer = false;
      }

      if (reachedServer && rows.length > 0 && cacheKey) {
        try {
          localStorage.setItem(cacheKey, JSON.stringify(rows));
        } catch {
          /* storage full / private mode */
        }
      } else if (!reachedServer || (rows.length === 0 && !navigator.onLine)) {
        rows = readCache();
      }

      setMemberships(rows);

      // Priority: 1. Query param 'ws' (slug), 2. LocalStorage, 3. First membership
      const urlParams = new URLSearchParams(window.location.search);
      const wsParam = urlParams.get("ws");
      const preferred =
        typeof window !== "undefined"
          ? localStorage.getItem(STORAGE_KEY)
          : null;

      let pickId = null;
      if (wsParam) {
        const found = rows.find((r) => r.workspace.slug === wsParam);
        if (found) pickId = found.workspace.id;
      }

      if (!pickId) {
        pickId =
          preferred && rows.some((r) => r.workspace.id === preferred)
            ? preferred
            : (rows[0]?.workspace?.id ?? null);
      }

      setActiveWorkspaceIdState(pickId);
      if (pickId && typeof window !== "undefined") {
        localStorage.setItem(STORAGE_KEY, pickId);
      }
    } finally {
      setIsLoading(false);
    }
  }, [auth.status, userId]);

  useEffect(() => {
    load();
  }, [load]);

  const activeWorkspace = useMemo(() => {
    const m = memberships.find((x) => x.workspace.id === activeWorkspaceId);
    return m?.workspace ?? memberships[0]?.workspace ?? null;
  }, [memberships, activeWorkspaceId]);

  const value = useMemo(
    (): WorkspaceContextValue => ({
      memberships,
      activeWorkspaceId,
      setActiveWorkspaceId,
      isLoading,
      bootstrap: load,
      refresh: load,
      activeWorkspace,
    }),
    [
      memberships,
      activeWorkspaceId,
      setActiveWorkspaceId,
      isLoading,
      load,
      activeWorkspace,
    ],
  );

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) {
    throw new Error("useWorkspace must be used within WorkspaceProvider");
  }
  return ctx;
}
