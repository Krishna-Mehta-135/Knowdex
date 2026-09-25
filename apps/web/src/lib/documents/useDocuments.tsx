"use client";

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/useAuth";
import { useWorkspace } from "@/lib/workspaces/WorkspaceProvider";
import type { Document } from "@repo/types";

interface DocumentsContextType {
  documents: Document[];
  isLoading: boolean;
  error: string | null;
  createDocument: (opts?: { folderPath?: string }) => Promise<Document | null>;
  deleteDocument: (docId: string) => Promise<void>;
  updateDocument: (
    docId: string,
    patch: Record<string, unknown>,
  ) => Promise<boolean>;
  patchDocumentInCache: (docId: string, partial: Partial<Document>) => void;
  /** Re-fetch the list (e.g. after a bulk import). */
  reload: () => void;
}

const DocumentsContext = createContext<DocumentsContextType | undefined>(
  undefined,
);

export function DocumentsProvider({ children }: { children: ReactNode }) {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const reload = useCallback(() => setReloadTick((t) => t + 1), []);
  const router = useRouter();
  const auth = useAuth();
  const { activeWorkspaceId, isLoading: wsLoading } = useWorkspace();

  const patchDocumentInCache = useCallback(
    (docId: string, partial: Partial<Document>) => {
      setDocuments((prev) =>
        prev.map((d) => (d.id === docId ? { ...d, ...partial } : d)),
      );
    },
    [],
  );

  useEffect(() => {
    const handler = (e: Event) => {
      const ev = e as CustomEvent<{ docId: string; title: string }>;
      if (!ev.detail?.docId) return;
      const t = ev.detail.title?.trim() ? ev.detail.title : "Untitled";
      patchDocumentInCache(ev.detail.docId, { title: t });
    };
    window.addEventListener("doc:title:changed", handler as EventListener);
    return () =>
      window.removeEventListener("doc:title:changed", handler as EventListener);
  }, [patchDocumentInCache]);

  useEffect(() => {
    if (auth.status !== "authenticated") {
      if (auth.status === "unauthenticated") setIsLoading(false);
      return;
    }
    if (wsLoading) return;

    if (!activeWorkspaceId) {
      setDocuments([]);
      setIsLoading(false);
      return;
    }

    const load = async () => {
      try {
        if (documents.length === 0) {
          setIsLoading(true);
        }
        setError(null);
        const qs = new URLSearchParams({ workspaceId: activeWorkspaceId });
        const res = await fetch(`/api/documents?${qs}`, {
          credentials: "include",
        });
        if (res.status === 401) {
          router.push("/login");
          setIsLoading(false);
          return;
        }
        if (!res.ok) throw new Error("Failed to load documents");
        const docs: Document[] = await res.json();
        setDocuments(
          [...docs].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)),
        );
        setIsLoading(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setIsLoading(false);
      }
    };

    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.status, router, activeWorkspaceId, wsLoading, reloadTick]);

  const createDocument = useCallback(
    async (opts?: { folderPath?: string }) => {
      const folderPath = (opts?.folderPath ?? "").trim();
      const tempId = `temp-${Date.now()}`;
      const tempDoc: Document = {
        id: tempId,
        title: "Untitled",
        ownerId: "",
        folderPath,
        tags: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      setDocuments((prev) => [tempDoc, ...prev]);

      try {
        const res = await fetch("/api/documents", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: "Untitled",
            workspaceId: activeWorkspaceId ?? undefined,
            folderPath,
            tags: [],
          }),
        });

        if (res.status === 401) {
          router.push("/login");
          return null;
        }

        if (!res.ok) throw new Error("Failed to create");
        const doc: Document = await res.json();

        setDocuments((prev) => prev.map((d) => (d.id === tempId ? doc : d)));
        return doc;
      } catch (err) {
        setDocuments((prev) => prev.filter((d) => d.id !== tempId));
        console.error("Failed to create document:", err);
        return null;
      }
    },
    [router, activeWorkspaceId],
  );

  const deleteDocument = useCallback(
    async (docId: string) => {
      const previousDocs = [...documents];
      setDocuments((prev) => prev.filter((d) => d.id !== docId));

      try {
        const res = await fetch(`/api/documents/${docId}`, {
          method: "DELETE",
          credentials: "include",
        });

        if (res.status === 401) {
          router.push("/login");
          return;
        }

        if (!res.ok) throw new Error("Failed to delete");
      } catch (err) {
        setDocuments(previousDocs);
        console.error("Failed to delete document:", err);
      }
    },
    [documents, router],
  );

  const updateDocument = useCallback(
    async (docId: string, patch: Record<string, unknown>) => {
      try {
        const res = await fetch(`/api/documents/${docId}`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (!res.ok) return false;
        const payload = await res.json();
        const raw = payload.data ?? payload;
        const normalizeTitle = (value: unknown) => {
          if (typeof value !== "string") return undefined;
          const title = value.trim();
          if (!title || title.toLowerCase() === "undefined") return "Untitled";
          return title;
        };
        const parsedTags = Array.isArray(raw.tags)
          ? raw.tags
              .map((t: { name?: string } | string) =>
                typeof t === "string" ? t : (t?.name ?? ""),
              )
              .filter(Boolean)
          : undefined;

        patchDocumentInCache(docId, {
          title: normalizeTitle(raw.title),
          folderPath:
            typeof raw.folderPath === "string" ? raw.folderPath : undefined,
          tags: parsedTags,
        });
        return true;
      } catch {
        return false;
      }
    },
    [patchDocumentInCache],
  );

  return (
    <DocumentsContext.Provider
      value={{
        documents,
        isLoading,
        error,
        createDocument,
        deleteDocument,
        updateDocument,
        patchDocumentInCache,
        reload,
      }}
    >
      {children}
    </DocumentsContext.Provider>
  );
}

export function useDocuments() {
  const context = useContext(DocumentsContext);
  if (context === undefined) {
    throw new Error("useDocuments must be used within a DocumentsProvider");
  }
  return context;
}
