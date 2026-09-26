"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { Document } from "@repo/types";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { LayoutGroup, motion } from "framer-motion";
import { useDocuments } from "@/lib/documents/useDocuments";
import {
  Skeleton,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@repo/ui";

import {
  FileText,
  MoreVertical,
  Trash2,
  ExternalLink,
  Copy,
  Edit2,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderInput,
  Plus,
  Star,
  ArrowUp,
} from "lucide-react";
import { useStarredDocs } from "@/lib/documents/useStarredDocs";
import { useWorkspace } from "@/lib/workspaces/WorkspaceProvider";
import {
  ROOT_LIST_KEY,
  orderItemsForSidebar,
} from "@/lib/documents/sidebarOrderStorage";
import { useSidebarObsidianDrag } from "@/lib/documents/useSidebarObsidianDrag";

const MENU_SURFACE =
  "w-52 p-1.5 bg-[#050505]/95 backdrop-blur-xl border-white/10 text-white shadow-xl rounded-xl";

/** Main document ⋮ menu — hide scrollbar (Radix applies overflow-y-auto on content). */
const DOC_MENU_SURFACE = `${MENU_SURFACE} sb-doc-dropdown-scroll`;

const SUBMENU_SCROLL_HIDE =
  "sb-move-to-folder-sub max-h-72 overflow-y-auto overflow-x-hidden min-w-[220px] overscroll-contain";

const ROW_LAYOUT = {
  layout: true as const,
  transition: { type: "spring" as const, stiffness: 520, damping: 34 },
};

function fuzzyMatch(str: string, pattern: string): boolean {
  if (!pattern) return true;
  pattern = pattern.replace(/\s+/g, "").toLowerCase();
  str = str.toLowerCase();
  let patternIdx = 0;
  for (let i = 0; i < str.length; i++) {
    if (str[i] === pattern[patternIdx]) {
      patternIdx++;
      if (patternIdx === pattern.length) return true;
    }
  }
  return false;
}

interface TreeNode {
  docs: Document[];
  children: Map<string, TreeNode>;
}

function insertDoc(root: TreeNode, doc: Document) {
  const raw = doc.folderPath?.trim() ?? "";
  const parts = raw
    ? raw
        .split("/")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  if (!parts.length) {
    root.docs.push(doc);
    return;
  }

  let cur = root;
  for (const segment of parts) {
    if (!cur.children.has(segment)) {
      cur.children.set(segment, { docs: [], children: new Map() });
    }
    cur = cur.children.get(segment)!;
  }
  cur.docs.push(doc);
}

function safeDocTitle(doc: Document) {
  const t = doc.title?.trim() ?? "";
  if (!t || t.toLowerCase() === "undefined") return "Untitled";
  return t;
}

function collectFolderPaths(docs: Document[]): string[] {
  const set = new Set<string>([""]);
  for (const d of docs) {
    const fp = (d.folderPath ?? "").trim();
    if (!fp) continue;
    const parts = fp
      .split("/")
      .map((s) => s.trim())
      .filter(Boolean);
    for (let i = 0; i < parts.length; i++) {
      set.add(parts.slice(0, i + 1).join("/"));
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

function folderLabel(path: string) {
  return path === "" ? "Workspace root" : path;
}

function untitledSubfolderUnder(doc: Document): string {
  const fp = (doc.folderPath ?? "").trim();
  return fp ? `${fp}/Untitled` : "Untitled";
}

function MoveDocToFolderSubmenu({
  doc,
  folderPathOptions,
  onMove,
  onCreateUntitledSubfolderIn,
  onCreateNewFolder,
}: {
  doc: Document;
  folderPathOptions: string[];
  onMove: (path: string) => void;
  onCreateUntitledSubfolderIn: (parentPath: string) => void;
  onCreateNewFolder: () => void;
}) {
  const [draft, setDraft] = useState(() => (doc.folderPath ?? "").trim());

  useEffect(() => {
    setDraft((doc.folderPath ?? "").trim());
  }, [doc.id, doc.folderPath]);

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-white/10 cursor-pointer focus:bg-white/10 text-xs data-[state=open]:bg-white/10">
        <FolderInput className="h-3.5 w-3.5 text-white/60" />
        <span className="font-medium">Move to folder</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent
        sideOffset={6}
        className={`${MENU_SURFACE} ${SUBMENU_SCROLL_HIDE}`}
      >
        <DropdownMenuItem
          className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-white/10 cursor-pointer focus:bg-white/10 text-xs"
          onSelect={() => onCreateNewFolder()}
        >
          <Plus
            size={12}
            className="text-[hsl(var(--sb-accent))]/90 shrink-0"
          />
          <span className="truncate font-medium">Create new folder…</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator className="my-1 bg-white/10" />
        {folderPathOptions.map((fp) => (
          <DropdownMenuItem
            key={fp || "__root__"}
            className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-white/10 cursor-pointer focus:bg-white/10 text-xs"
            onSelect={() => onMove(fp)}
          >
            <Folder
              size={12}
              className="text-[hsl(var(--sb-accent))]/80 shrink-0"
            />
            <span className="truncate">{folderLabel(fp)}</span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator className="my-1 bg-white/10" />
        <div className="px-2 py-1 text-[9px] font-bold text-white/40 uppercase tracking-widest">
          Create Untitled subfolder under
        </div>
        {folderPathOptions.map((fp) => (
          <DropdownMenuItem
            key={`newsub-${fp || "__root__"}`}
            className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-white/10 cursor-pointer focus:bg-white/10 text-xs"
            onSelect={() => onCreateUntitledSubfolderIn(fp)}
          >
            <Plus
              size={12}
              className="text-[hsl(var(--sb-accent))]/80 shrink-0"
            />
            <span className="truncate">{folderLabel(fp)}</span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator className="my-1 bg-white/10" />
        <DropdownMenuItem
          className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-white/10 cursor-pointer focus:bg-white/10 text-xs"
          onSelect={() => onMove(untitledSubfolderUnder(doc))}
        >
          <Folder
            size={12}
            className="text-[hsl(var(--sb-accent))]/80 shrink-0"
          />
          <span className="truncate">
            New Untitled subfolder (under this note&apos;s folder)
          </span>
        </DropdownMenuItem>
        {(doc.folderPath ?? "").trim() ? (
          <DropdownMenuItem
            className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-white/10 cursor-pointer focus:bg-white/10 text-xs"
            onSelect={() => onMove("Untitled")}
          >
            <Folder size={12} className="text-white/50 shrink-0" />
            <span className="truncate">
              New Untitled subfolder at workspace root
            </span>
          </DropdownMenuItem>
        ) : null}
        <div
          className="border-t border-white/10 p-2 space-y-2 mt-1"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <p className="text-[9px] font-bold uppercase tracking-wider text-white/35">
            New folder path
          </p>
          <p className="text-[10px] text-white/40 leading-snug">
            Folders exist when at least one note uses that path. Type a new path
            (use / between segments) and apply.
          </p>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            className="w-full rounded-md bg-black/50 border border-white/12 px-2 py-1.5 text-xs text-white placeholder:text-white/30 focus:outline-none focus:ring-1 focus:ring-[hsl(var(--sb-accent))]/50"
            placeholder="e.g. Projects / Ideas"
          />
          <button
            type="button"
            className="w-full rounded-md bg-[hsl(var(--sb-accent))]/20 text-[hsl(var(--sb-accent))] text-xs py-1.5 font-medium hover:bg-[hsl(var(--sb-accent))]/30 transition-colors"
            onClick={() => onMove(draft.trim())}
          >
            Move to this path
          </button>
        </div>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

function insertionRail(key: string) {
  return (
    <motion.li
      key={key}
      layout
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 2 }}
      exit={{ opacity: 0, height: 0 }}
      className="list-none mx-2 my-0.5 h-0.5 bg-[hsl(var(--sb-accent))] shadow-[0_0_8px_hsla(var(--sb-accent)/0.4)] rounded-full z-10"
    />
  );
}

const FolderTreeBranch = React.memo(function FolderTreeBranch({
  segments,
  node,
  renderOrderedListInFolder,
  onNewNoteInFolder,
  onNewSubfolder,
  nestHoverPath,
  beginFolderDrag,
  isDragging,
  activeDragFolderPath,
}: {
  segments: string[];
  node: TreeNode;
  renderOrderedListInFolder: (
    folderListKey: string,
    docs: Document[],
    children: Map<string, TreeNode>,
  ) => ReactNode;
  onNewNoteInFolder: (folderPath: string) => void;
  onNewSubfolder: (parentPath: string) => void;
  nestHoverPath: string | undefined;
  beginFolderDrag: (
    pointerId: number,
    folderPath: string,
    srcListKey: string,
    x: number,
    y: number,
  ) => void;
  isDragging: boolean;
  activeDragFolderPath: string | undefined;
}) {
  const pathname = usePathname();
  const label = segments[segments.length - 1] ?? "";
  const pathKey = segments.join("/");
  const [open, setOpen] = useState(segments.length <= 2);
  const {
    documents: allDocuments,
    deleteDocument,
    updateDocument,
  } = useDocuments();
  // Database rows are managed from their database, not the note tree.
  const documents = useMemo(
    () => allDocuments.filter((d: Document) => !d.databaseId),
    [allDocuments],
  );
  const nestTarget = nestHoverPath === pathKey;
  const isThisFolderDragging = activeDragFolderPath === pathKey;
  const [isEditing, setIsEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  useEffect(() => {
    const handler = (e: Event) => {
      const ev = e as CustomEvent<{ path: string }>;
      if (ev.detail.path === pathKey) {
        setIsEditing(true);
      }
    };
    window.addEventListener("knowdex:edit-folder", handler);
    return () => window.removeEventListener("knowdex:edit-folder", handler);
  }, [pathKey]);

  const handleRename = (newName: string) => {
    setIsEditing(false);
    if (!newName.trim() || newName.trim() === label) return;
    const safeName = newName.trim().replace(/\//g, "-");
    const parentPath = segments.slice(0, -1).join("/");
    const target = parentPath ? `${parentPath}/${safeName}` : safeName;

    const toUpdate = documents.filter((d: Document) => {
      const fp = (d.folderPath ?? "").trim();
      return fp === pathKey || fp.startsWith(pathKey + "/");
    });

    toUpdate.forEach((d: Document) => {
      const suffix = d.folderPath!.substring(pathKey.length);
      const patch: Partial<Document> = { folderPath: target + suffix };
      if (d.folderPath === pathKey && safeDocTitle(d) === label) {
        patch.title = safeName;
      }
      void updateDocument(d.id, patch);
    });
  };

  const representativeDoc = useMemo(() => {
    return node.docs.find((d) => safeDocTitle(d) === label);
  }, [node.docs, label]);

  const otherDocs = useMemo(() => {
    return representativeDoc
      ? node.docs.filter((d) => d.id !== representativeDoc.id)
      : node.docs;
  }, [node.docs, representativeDoc]);

  const isActive =
    representativeDoc && pathname === `/documents/${representativeDoc.id}`;

  return (
    <div className={segments.length ? "ml-4" : ""}>
      <div
        data-sb-folder-header
        data-sb-folder-path={pathKey}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          const target = e.target as HTMLElement;
          // Only exclude the specific actions button, allow dragging on the main header/label
          if (target.closest('button[aria-label="Folder actions"]')) return;
          // Allow clicks on the chevron to pass through to toggle
          if (target.closest(".sb-folder-toggle")) return;

          const parentKey = segments.slice(0, -1).join("/") || ROOT_LIST_KEY;
          beginFolderDrag(
            e.pointerId,
            pathKey,
            parentKey,
            e.clientX,
            e.clientY,
          );
        }}
        className={`flex items-center gap-0.5 rounded-md group/frow pr-0.5 transition-all duration-150 select-none touch-none ${
          nestTarget
            ? "bg-[hsl(var(--sb-accent))]/18 ring-1 ring-[hsl(var(--sb-accent))]/55 shadow-[inset_0_0_0_1px_hsl(var(--sb-accent)/0.2)]"
            : isThisFolderDragging && isDragging
              ? "opacity-0"
              : isThisFolderDragging
                ? "opacity-30"
                : isActive
                  ? "bg-[hsl(var(--sb-accent))]/10"
                  : "hover:bg-[hsl(var(--sb-bg-hover))]/50"
        }`}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setOpen((v) => !v);
          }}
          className="sb-folder-toggle p-1.5 rounded text-[hsl(var(--sb-text-faint))] hover:text-white transition-colors"
        >
          {open ? (
            <ChevronDown size={13} className="shrink-0 opacity-70" />
          ) : (
            <ChevronRight size={13} className="shrink-0 opacity-70" />
          )}
        </button>

        {representativeDoc ? (
          <Link
            href={`/documents/${representativeDoc.id}`}
            draggable={false}
            className={`flex-1 min-w-0 flex items-center gap-1.5 text-[14px] py-1.5 pr-2 rounded font-medium transition-colors ${
              isActive
                ? "text-[hsl(var(--sb-accent))]"
                : "text-[hsl(var(--sb-text-muted))] hover:text-white"
            }`}
          >
            <Folder
              size={13}
              className={`shrink-0 ${isActive ? "text-[hsl(var(--sb-accent))]" : "opacity-70"}`}
            />
            {isEditing ? (
              <input
                ref={inputRef}
                onFocus={(e) => e.currentTarget.select()}
                defaultValue={label}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleRename(e.currentTarget.value);
                  else if (e.key === "Escape") setIsEditing(false);
                }}
                onBlur={(e) => handleRename(e.currentTarget.value)}
                onClick={(e) => e.preventDefault()}
                className="flex-1 bg-transparent outline-none ring-1 ring-[hsl(var(--sb-accent))] px-1 rounded truncate min-w-0"
              />
            ) : (
              <span className="truncate">{label}</span>
            )}
          </Link>
        ) : (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex flex-1 min-w-0 items-center gap-1.5 text-[14px] py-1.5 pr-2 rounded text-[hsl(var(--sb-text-muted))] hover:text-white text-left transition-colors font-medium"
          >
            <Folder size={13} className="shrink-0 opacity-70" />
            {isEditing ? (
              <input
                ref={inputRef}
                onFocus={(e) => e.currentTarget.select()}
                defaultValue={label}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleRename(e.currentTarget.value);
                  else if (e.key === "Escape") setIsEditing(false);
                }}
                onBlur={(e) => handleRename(e.currentTarget.value)}
                onClick={(e) => e.stopPropagation()}
                className="flex-1 bg-transparent outline-none ring-1 ring-[hsl(var(--sb-accent))] px-1 rounded truncate min-w-0"
              />
            ) : (
              <span className="truncate">{label}</span>
            )}
          </button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="shrink-0 p-1 rounded opacity-0 group-hover/frow:opacity-100 text-[hsl(var(--sb-text-faint))] hover:text-white hover:bg-[hsl(var(--sb-bg-hover))] transition-all mr-1.5"
              aria-label="Folder actions"
              onClick={(e) => e.stopPropagation()}
            >
              <Plus size={12} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className={MENU_SURFACE}
            onCloseAutoFocus={(e) => e.preventDefault()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <DropdownMenuItem
              className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-white/10 cursor-pointer focus:bg-white/10 text-xs"
              onSelect={() => onNewNoteInFolder(pathKey)}
            >
              <FileText size={12} className="text-white/55" />
              New note in folder
            </DropdownMenuItem>
            <DropdownMenuItem
              className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-white/10 cursor-pointer focus:bg-white/10 text-xs"
              onSelect={() => onNewSubfolder(pathKey)}
            >
              <Folder size={12} className="text-[hsl(var(--sb-accent))]/90" />
              New subfolder (Untitled)
            </DropdownMenuItem>
            {pathKey.includes("/") && (
              <DropdownMenuItem
                className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-white/10 cursor-pointer focus:bg-white/10 text-xs"
                onSelect={() => {
                  const parts = pathKey.split("/").filter(Boolean);
                  if (parts.length < 2) return;
                  const folderName = parts[parts.length - 1];
                  const parentOfParent = parts.slice(0, -2).join("/");
                  const newPath = parentOfParent
                    ? `${parentOfParent}/${folderName}`
                    : folderName;

                  const toUpdate = documents.filter((d: Document) => {
                    const fp = (d.folderPath ?? "").trim();
                    return fp === pathKey || fp.startsWith(pathKey + "/");
                  });

                  toUpdate.forEach((d: Document) => {
                    const suffix = d.folderPath!.substring(pathKey.length);
                    void updateDocument(d.id, { folderPath: newPath + suffix });
                  });
                }}
              >
                <ArrowUp size={12} className="text-white/55" />
                Move folder up
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-white/10 cursor-pointer focus:bg-white/10 text-xs"
              onSelect={() => setIsEditing(true)}
            >
              <Edit2 size={12} className="text-white/55" />
              Rename folder
            </DropdownMenuItem>
            <DropdownMenuSeparator className="my-1 bg-white/10" />
            <DropdownMenuItem
              className="flex items-center gap-2 px-2 py-1.5 rounded-md text-red-400 hover:bg-red-500/10 hover:text-red-300 cursor-pointer focus:bg-red-500/10 focus:text-red-300 text-xs"
              onSelect={() => {
                if (
                  window.confirm(
                    `Delete folder "${label}" and all its contents?`,
                  )
                ) {
                  const toDelete = documents.filter((d: Document) => {
                    const fp = (d.folderPath ?? "").trim();
                    return fp === pathKey || fp.startsWith(pathKey + "/");
                  });
                  toDelete.forEach((d: Document) => void deleteDocument(d.id));
                }
              }}
            >
              <Trash2 size={12} />
              Delete folder
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {open && (
        <div className="mt-0.5 space-y-0.5">
          <LayoutGroup id={`sb-tree-${pathKey.replace(/\//g, "_")}`}>
            <ul
              data-sb-doc-list={pathKey}
              className="space-y-0.5 list-none p-0 m-0"
            >
              {renderOrderedListInFolder(pathKey, otherDocs, node.children)}
            </ul>
          </LayoutGroup>
        </div>
      )}
    </div>
  );
});

export function SidebarDocumentList({
  search,
  tagFilter,
}: {
  search: string;
  tagFilter?: string | null;
}) {
  const {
    documents,
    isLoading,
    deleteDocument,
    updateDocument,
    createDocument,
    patchDocumentInCache,
  } = useDocuments();
  const { activeWorkspaceId } = useWorkspace();
  const { toggleStar, isStarred } = useStarredDocs();
  const pathname = usePathname();
  const router = useRouter();

  const filteredRef = useRef<Document[]>([]);

  const filteredDocuments = useMemo(
    () =>
      documents.filter((doc) => {
        const title = doc.title ?? "";
        const folder = doc.folderPath ?? "";
        const searchLower = search.toLowerCase();
        const matchesText =
          !search ||
          fuzzyMatch(title, search) ||
          title.toLowerCase().includes(searchLower) ||
          fuzzyMatch(folder, search) ||
          folder.toLowerCase().includes(searchLower) ||
          (Array.isArray(doc.tags) &&
            doc.tags.some((t) => {
              if (!t) return false;
              const s = (typeof t === "string" ? t : String(t)).toLowerCase();
              return fuzzyMatch(s, search) || s.includes(searchLower);
            }));
        const matchesTag =
          !tagFilter ||
          (doc.tags ?? []).some(
            (t) => t && t.toLowerCase() === tagFilter.toLowerCase(),
          );
        return matchesText && matchesTag;
      }),
    [documents, search, tagFilter],
  );

  filteredRef.current = filteredDocuments;

  const { session, hit, beginGripDrag, beginFolderDrag, isDragging } =
    useSidebarObsidianDrag({
      workspaceId: activeWorkspaceId,
      getDocuments: () => filteredRef.current,
      updateDocument,
      patchDocumentInCache,
    });

  const nestHoverPath = hit?.type === "nest" ? hit.folderPath : undefined;
  const activeDragFolderPath = session?.folderPath;

  const wsId = activeWorkspaceId ?? null;

  const folderPathOptions = useMemo(
    () => collectFolderPaths(documents),
    [documents],
  );

  const newNoteInFolder = useCallback(
    async (folderPath: string) => {
      const d = await createDocument({ folderPath });
      if (d?.id) router.push(`/documents/${d.id}`);
    },
    [createDocument, router],
  );

  const newSubfolder = useCallback(
    async (parentPath: string) => {
      const sub = parentPath ? `${parentPath}/Untitled` : "Untitled";
      const d = await createDocument({ folderPath: sub });
      if (d?.id) router.push(`/documents/${d.id}`);
    },
    [createDocument, router],
  );

  const tree = useMemo(() => {
    const root: TreeNode = { docs: [], children: new Map() };
    for (const d of filteredDocuments) insertDoc(root, d);
    return root;
  }, [filteredDocuments]);

  /* --- One motion row -------------------------------------------------- */
  const renderDocRowMotion = useCallback(
    (doc: Document, listKey: string) => {
      const isActive = pathname === `/documents/${doc.id}`;
      const isTemp = doc.id.startsWith("temp-");
      const safeTitle = safeDocTitle(doc);
      const draggingHere = session?.docId === doc.id;
      const isNestTarget = hit?.type === "nest" && hit.targetDocId === doc.id;

      return (
        <motion.li
          {...ROW_LAYOUT}
          layout="position"
          key={`${listKey}:${doc.id}`}
          data-sb-doc-row
          data-doc-id={doc.id}
          data-doc-title={safeTitle}
          data-doc-folder={doc.folderPath ?? ""}
          style={{
            zIndex: draggingHere ? 50 : 1,
            touchAction: "none",
          }}
          onPointerDown={(e) => {
            if (isTemp || e.button !== 0) return;
            const target = e.target as HTMLElement;
            // Let button clicks (dropdown trigger) pass through.
            if (target.closest("button")) return;
            // Removed setPointerCapture to allow smooth Link interaction and native focus.
            beginGripDrag(e.pointerId, doc.id, listKey, e.clientX, e.clientY);
          }}
          className={`group list-none rounded-md transition-all duration-150 select-none ${
            draggingHere && isDragging
              ? "opacity-0"
              : draggingHere
                ? "opacity-30"
                : isNestTarget
                  ? "bg-[hsl(var(--sb-accent))]/25 ring-1 ring-[hsl(var(--sb-accent))]/60 shadow-[inset_0_0_0_1px_hsl(var(--sb-accent)/0.3)]"
                  : ""
          }`}
        >
          <div className="flex w-full min-w-0 items-center gap-0.5 ml-4">
            <Link
              href={isTemp ? "#" : `/documents/${doc.id}`}
              draggable={false}
              className={`
                flex items-center gap-2 px-2 py-1.5 rounded-md text-[14px] transition-colors flex-1 min-w-0
                ${
                  isActive
                    ? "!text-[hsl(var(--sb-accent))] font-medium"
                    : "!text-white/70 hover:bg-[hsl(var(--sb-bg-hover))] hover:!text-white"
                }
                ${isTemp ? "opacity-50 cursor-not-allowed" : ""}
              `}
              onClick={(e) => isTemp && e.preventDefault()}
            >
              <FileText
                className={`h-3.5 w-3.5 shrink-0 ${isActive ? "text-[hsl(var(--sb-accent))]" : "!text-white/40 group-hover:!text-white"}`}
              />
              <span className="truncate">{safeTitle || "Untitled"}</span>
            </Link>

            {!isTemp && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    aria-label="Document actions"
                    className={`
                      p-1 hover:bg-[hsl(var(--sb-bg-hover))] rounded-md transition-all text-[hsl(var(--sb-text-faint))] hover:text-white focus:opacity-100 shrink-0 mr-1.5
                      ${isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100"}
                    `}
                  >
                    <MoreVertical className="h-3.5 w-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className={DOC_MENU_SURFACE}
                  onCloseAutoFocus={(e) => e.preventDefault()}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <div className="px-2 py-1.5 text-[11px] font-bold text-white/40 uppercase tracking-widest">
                    DOCUMENT
                  </div>
                  <DropdownMenuItem
                    onSelect={() =>
                      window.open(`/documents/${doc.id}`, "_blank")
                    }
                    className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-white/10 cursor-pointer focus:bg-white/10"
                  >
                    <ExternalLink className="h-3.5 w-3.5 text-white/60" />
                    <span className="text-xs font-medium">Open in new tab</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-white/10 cursor-pointer focus:bg-white/10"
                    onSelect={() => {
                      navigator.clipboard.writeText(
                        `${typeof window !== "undefined" ? window.location.origin : ""}/documents/${doc.id}`,
                      );
                    }}
                  >
                    <Copy className="h-3.5 w-3.5 text-white/60" />
                    <span className="text-xs font-medium">Copy link</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-white/10 cursor-pointer focus:bg-white/10"
                    onSelect={() => {
                      const nt = window.prompt("Rename document", safeTitle);
                      if (nt && nt.trim())
                        void updateDocument(doc.id, { title: nt.trim() });
                    }}
                  >
                    <Edit2 className="h-3.5 w-3.5 text-white/60" />
                    <span className="text-xs font-medium">Rename</span>
                  </DropdownMenuItem>
                  <MoveDocToFolderSubmenu
                    key={`move-${doc.id}`}
                    doc={doc}
                    folderPathOptions={folderPathOptions}
                    onMove={(path) =>
                      void updateDocument(doc.id, { folderPath: path })
                    }
                    onCreateUntitledSubfolderIn={(parentPath) =>
                      void newSubfolder(parentPath)
                    }
                    onCreateNewFolder={() => {
                      const base = (doc.folderPath ?? "").trim();
                      const hint = base
                        ? `${base}/New folder`
                        : "Projects/Ideas";
                      const raw = window.prompt(
                        "Folder path (segments separated by /). A starter note will be created in that folder.",
                        hint,
                      );
                      const path = raw?.trim().replace(/^\/+|\/+$/g, "") ?? "";
                      if (!path) return;
                      void createDocument({ folderPath: path }).then((d) => {
                        if (d?.id) router.push(`/documents/${d.id}`);
                      });
                    }}
                  />
                  {(doc.folderPath ?? "").trim() ? (
                    <DropdownMenuItem
                      className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-white/10 cursor-pointer focus:bg-white/10"
                      onSelect={() => {
                        const parts = (doc.folderPath ?? "")
                          .split("/")
                          .filter(Boolean);
                        const parent = parts.slice(0, -1).join("/");
                        void updateDocument(doc.id, { folderPath: parent });
                      }}
                    >
                      <ArrowUp className="h-3.5 w-3.5 text-white/60" />
                      <span className="text-xs font-medium">
                        Move up to parent
                      </span>
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuItem
                    className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-white/10 cursor-pointer focus:bg-white/10"
                    onSelect={() => toggleStar(doc.id)}
                  >
                    <Star
                      className={`h-3.5 w-3.5 ${isStarred(doc.id) ? "text-amber-400 fill-amber-400" : "text-white/60"}`}
                    />
                    <span className="text-xs font-medium">
                      {isStarred(doc.id) ? "Remove star" : "Star document"}
                    </span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator className="my-1 bg-white/10" />
                  <DropdownMenuItem
                    onSelect={() => deleteDocument(doc.id)}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-md text-red-400 hover:bg-red-500/10 hover:text-red-300 cursor-pointer focus:bg-red-500/10 focus:text-red-300"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span className="text-xs font-medium">Delete document</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </motion.li>
      );
    },
    [
      pathname,
      session?.docId,
      isDragging,
      hit,
      beginGripDrag,
      toggleStar,
      isStarred,
      updateDocument,
      deleteDocument,
      folderPathOptions,
      newSubfolder,
      createDocument,
      router,
    ],
  );

  const renderOrderedListInFolder = useCallback(
    (
      listKey: string,
      docsAtLeaf: Document[],
      childrenAtLeaf: Map<string, TreeNode>,
    ) => {
      const folderNames = [...childrenAtLeaf.keys()];
      const docIds = docsAtLeaf.map((d) => d.id);

      const orderedIdentities = orderItemsForSidebar(
        wsId,
        listKey,
        docIds,
        folderNames,
      );

      const reorderHit = hit?.type === "reorder" ? hit : null;
      const railForList = Boolean(session) && reorderHit?.listKey === listKey;
      const li = reorderHit?.listKey === listKey ? reorderHit.insertIndex : -1;

      const out: ReactNode[] = [];

      const renderItem = (ident: string, idx: number) => {
        if (railForList && li === idx) {
          out.push(insertionRail(`rail-${listKey}-${idx}`));
        }

        if (ident.startsWith("doc:")) {
          const id = ident.substring(4);
          const doc = docsAtLeaf.find((d) => d.id === id);
          if (doc) out.push(renderDocRowMotion(doc, listKey));
        } else if (ident.startsWith("folder:")) {
          const name = ident.substring(7);
          const node = childrenAtLeaf.get(name);
          if (node) {
            out.push(
              <div key={`${listKey}:folder:${name}`} className="mb-2">
                <FolderTreeBranch
                  segments={[
                    ...(listKey === ROOT_LIST_KEY ? [] : listKey.split("/")),
                    name,
                  ]}
                  node={node}
                  renderOrderedListInFolder={renderOrderedListInFolder}
                  onNewNoteInFolder={newNoteInFolder}
                  onNewSubfolder={newSubfolder}
                  nestHoverPath={nestHoverPath}
                  beginFolderDrag={beginFolderDrag}
                  isDragging={isDragging}
                  activeDragFolderPath={activeDragFolderPath}
                />
              </div>,
            );
          }
        }
      };

      orderedIdentities.forEach((ident, idx) => renderItem(ident, idx));

      if (railForList && li >= orderedIdentities.length) {
        out.push(insertionRail(`rail-${listKey}-end`));
      }
      return <>{out}</>;
    },
    [
      session,
      hit,
      wsId,
      renderDocRowMotion,
      newNoteInFolder,
      newSubfolder,
      nestHoverPath,
      beginFolderDrag,
      isDragging,
      activeDragFolderPath,
    ],
  );

  if (isLoading) {
    return (
      <div className="space-y-1 py-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-full rounded-md" />
        ))}
      </div>
    );
  }

  if (documents.length === 0) {
    return (
      <p className="text-xs text-[hsl(var(--sb-text-faint))] px-2 py-4 text-center">
        No documents yet
      </p>
    );
  }

  if (filteredDocuments.length === 0 && (search || tagFilter)) {
    return (
      <p className="text-xs text-[hsl(var(--sb-text-faint))] px-2 py-4 text-center">
        No matches
        {search ? ` for "${search}"` : ""}
        {tagFilter ? ` in #${tagFilter}` : ""}
      </p>
    );
  }

  return (
    <div className="space-y-0.5 py-2 select-none">
      {/* Drag Ghost */}
      {session &&
        (session.docId || session.folderPath) &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed z-[9999] pointer-events-none opacity-90 bg-[hsl(var(--sb-bg-panel))] border border-[hsl(var(--sb-accent))/40] rounded-md shadow-2xl flex items-center gap-2 px-3 py-2 text-[13px] text-white/90"
            style={{
              left: session.currentX - 20,
              top: session.currentY - 15,
              width: 200,
            }}
          >
            {session.docId ? (
              <FileText className="h-3.5 w-3.5 shrink-0 text-white/50" />
            ) : (
              <Folder className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--sb-accent))]/80" />
            )}
            <span className="truncate">
              {session.docId
                ? safeDocTitle(documents.find((d) => d.id === session.docId)!)
                : session.folderPath?.split("/").pop()}
            </span>
          </div>,
          document.body,
        )}

      <LayoutGroup id="sb-root-list">
        <ul
          data-sb-doc-list={ROOT_LIST_KEY}
          className="space-y-0.5 list-none p-0 m-0"
        >
          {renderOrderedListInFolder(ROOT_LIST_KEY, tree.docs, tree.children)}
        </ul>
      </LayoutGroup>
    </div>
  );
}
