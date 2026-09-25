"use client";
import type { Editor } from "@tiptap/react";
import { Tooltip, TooltipContent, TooltipTrigger, Separator } from "@repo/ui";
import { useUndoManager } from "./hooks/useUndoManager";
import { useSyncManager } from "@/lib/sync/SyncContext";
import {
  Undo2,
  Redo2,
  Bold,
  Italic,
  Strikethrough,
  Code,
  Heading1,
  Heading2,
  List,
  ListOrdered,
  SquareCheck,
  Quote,
  History,
} from "lucide-react";

interface ToolbarProps {
  editor?: Editor | null;
  onOpenHistory?: () => void;
}

export function EditorToolbar({ editor, onOpenHistory }: ToolbarProps) {
  const manager = useSyncManager();
  const { undo, redo, canUndo, canRedo } = useUndoManager(manager.doc);

  // If no editor is provided yet, we still show the toolbar but formatting is disabled
  const isReady = !!editor;

  const groups = [
    {
      label: "History",
      items: [
        {
          label: "Undo",
          shortcut: "⌘Z",
          action: undo,
          active: false,
          disabled: !canUndo,
          icon: <Undo2 size={16} />,
        },
        {
          label: "Redo",
          shortcut: "⌘⇧Z",
          action: redo,
          active: false,
          disabled: !canRedo,
          icon: <Redo2 size={16} />,
        },
      ],
    },
    {
      label: "Format",
      items: [
        {
          label: "Bold",
          shortcut: "⌘B",
          action: () => editor?.chain().focus().toggleBold().run(),
          active: editor?.isActive("bold") ?? false,
          disabled: !isReady,
          icon: <Bold size={16} />,
        },
        {
          label: "Italic",
          shortcut: "⌘I",
          action: () => editor?.chain().focus().toggleItalic().run(),
          active: editor?.isActive("italic") ?? false,
          disabled: !isReady,
          icon: <Italic size={16} />,
        },
        {
          label: "Strike",
          shortcut: "⌘⇧S",
          action: () => editor?.chain().focus().toggleStrike().run(),
          active: editor?.isActive("strike") ?? false,
          disabled: !isReady,
          icon: <Strikethrough size={16} />,
        },
        {
          label: "Code",
          shortcut: "⌘E",
          action: () => editor?.chain().focus().toggleCode().run(),
          active: editor?.isActive("code") ?? false,
          disabled: !isReady,
          icon: <Code size={16} />,
        },
      ],
    },
    {
      label: "Structure",
      items: [
        {
          label: "H1",
          action: () =>
            editor?.chain().focus().toggleHeading({ level: 1 }).run(),
          active: editor?.isActive("heading", { level: 1 }) ?? false,
          disabled: !isReady,
          icon: <Heading1 size={16} />,
        },
        {
          label: "H2",
          action: () =>
            editor?.chain().focus().toggleHeading({ level: 2 }).run(),
          active: editor?.isActive("heading", { level: 2 }) ?? false,
          disabled: !isReady,
          icon: <Heading2 size={16} />,
        },
        {
          label: "Bullet List",
          action: () => editor?.chain().focus().toggleBulletList().run(),
          active: editor?.isActive("bulletList") ?? false,
          disabled: !isReady,
          icon: <List size={16} />,
        },
        {
          label: "Numbered",
          action: () => editor?.chain().focus().toggleOrderedList().run(),
          active: editor?.isActive("orderedList") ?? false,
          disabled: !isReady,
          icon: <ListOrdered size={16} />,
        },
        {
          label: "Task List",
          action: () => editor?.chain().focus().toggleTaskList().run(),
          active: editor?.isActive("taskList") ?? false,
          disabled: !isReady,
          icon: <SquareCheck size={18} className="md:scale-110" />,
        },
        {
          label: "Code Block",
          action: () => editor?.chain().focus().toggleCodeBlock().run(),
          active: editor?.isActive("codeBlock") ?? false,
          disabled: !isReady,
          icon: <Code size={16} />,
        },
        {
          label: "Quote",
          action: () => editor?.chain().focus().toggleBlockquote().run(),
          active: editor?.isActive("blockquote") ?? false,
          disabled: !isReady,
          icon: <Quote size={16} />,
        },
      ],
    },
  ];

  return (
    <div className="flex items-center gap-3 px-4 py-2 border-b border-[hsl(var(--sb-border))] overflow-x-auto bg-[#0a0a0a] sticky top-0 z-10 custom-scrollbar min-h-[56px] md:min-h-0">
      {groups.map((group, gi) => (
        <div key={group.label} className="flex items-center gap-2">
          {gi === 1 && ( // Before Format (Bold)
            <Separator
              orientation="vertical"
              className="mx-3 h-5 bg-[hsl(var(--sb-border))]"
            />
          )}
          {group.items.map((item) => (
            <Tooltip key={item.label}>
              <TooltipTrigger asChild>
                <button
                  onClick={item.action}
                  disabled={item.disabled}
                  aria-pressed={item.active}
                  className={`
                    px-2.5 py-1.5 rounded text-sm font-bold transition-colors
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--sb-accent))]
                    ${item.active ? "bg-[hsl(var(--sb-accent))]/20 text-[hsl(var(--sb-accent))] border border-[hsl(var(--sb-accent))]/30" : "bg-transparent text-white/70 hover:bg-white/10 hover:text-white border border-transparent"}
                    ${item.disabled ? "opacity-30 cursor-not-allowed" : "cursor-pointer"}
                    flex items-center justify-center min-w-[36px] min-h-[36px] md:min-w-0 md:min-h-0
                  `}
                >
                  {item.label === "Task List" ? (
                    <SquareCheck size={20} className="md:scale-125" />
                  ) : (
                    item.icon
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent
                side="bottom"
                className="bg-[#1a1a1a] text-white border-[hsl(var(--sb-border))]"
              >
                <div className="flex flex-col items-center">
                  <span>
                    {item.label === "Bold"
                      ? `| ${item.label}`
                      : item.label === "Quote"
                        ? `${item.label} |`
                        : item.label}
                  </span>
                  {"shortcut" in item && (
                    <kbd className="text-[10px] opacity-80 bg-black/50 border border-white/10 px-1 rounded mt-1">
                      {item.shortcut}
                    </kbd>
                  )}
                </div>
              </TooltipContent>
            </Tooltip>
          ))}
          {gi === 2 && ( // After Structure (Quote)
            <Separator
              orientation="vertical"
              className="mx-3 h-5 bg-[hsl(var(--sb-border))]"
            />
          )}
        </div>
      ))}
      {onOpenHistory && (
        <button
          onClick={onOpenHistory}
          aria-label="Version history"
          title="Version history"
          className="ml-auto flex items-center gap-1.5 rounded border border-transparent px-2.5 py-1.5 text-xs text-white/70 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--sb-accent))]"
        >
          <History size={16} />{" "}
          <span className="hidden sm:inline">History</span>
        </button>
      )}
    </div>
  );
}
