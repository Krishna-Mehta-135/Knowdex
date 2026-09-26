"use client";

import { useState } from "react";
import { ArrowDownAZ, ArrowUpZA, EyeOff, Plus, Trash2, X } from "lucide-react";
import {
  OPTION_COLORS,
  PROP_TYPE_LABELS,
  COLOR_CLASSES,
  type OptionColor,
  type Property,
  type PropType,
} from "@/lib/databases/types";
import { slugify } from "@/lib/databases/view";

const field =
  "w-full rounded-md border border-[hsl(var(--sb-border-hover))] bg-transparent px-2 py-1.5 text-sm outline-none focus:border-[hsl(var(--sb-accent))]";
const menuBtn =
  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-[hsl(var(--sb-text-muted))] hover:bg-[hsl(var(--sb-bg-hover))] hover:text-white";

function Popover({
  onClose,
  children,
  label,
}: {
  onClose: () => void;
  children: React.ReactNode;
  label: string;
}) {
  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <div
        role="dialog"
        aria-label={label}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
        className="absolute left-0 top-full z-40 mt-1 w-64 rounded-xl border border-[hsl(var(--sb-border))] bg-[hsl(var(--sb-bg-panel))] p-2 shadow-2xl"
      >
        {children}
      </div>
    </>
  );
}

/** Column header menu: rename, sort, hide, edit options, delete. */
export function PropertyMenu({
  prop,
  onClose,
  onRename,
  onSort,
  onHide,
  onDelete,
  onOptions,
}: {
  prop: Property;
  onClose: () => void;
  onRename: (name: string) => void;
  onSort: (dir: "asc" | "desc") => void;
  onHide: () => void;
  onDelete: () => void;
  onOptions: (options: NonNullable<Property["options"]>) => void;
}) {
  const [name, setName] = useState(prop.name);
  const [newOpt, setNewOpt] = useState("");
  const options = prop.options ?? [];
  const isSelect = prop.type === "select" || prop.type === "multiselect";

  return (
    <Popover onClose={onClose} label={`${prop.name} property`}>
      <input
        autoFocus
        aria-label="Property name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() =>
          name.trim() && name.trim() !== prop.name && onRename(name.trim())
        }
        onKeyDown={(e) =>
          e.key === "Enter" && (e.target as HTMLInputElement).blur()
        }
        className={field}
      />
      <p className="px-1 pb-1 pt-1 text-[10px] uppercase tracking-wider text-[hsl(var(--sb-text-faint))]">
        {PROP_TYPE_LABELS[prop.type]}
      </p>
      <button
        className={menuBtn}
        onClick={() => {
          onSort("asc");
          onClose();
        }}
      >
        <ArrowDownAZ size={14} /> Sort ascending
      </button>
      <button
        className={menuBtn}
        onClick={() => {
          onSort("desc");
          onClose();
        }}
      >
        <ArrowUpZA size={14} /> Sort descending
      </button>
      <button
        className={menuBtn}
        onClick={() => {
          onHide();
          onClose();
        }}
      >
        <EyeOff size={14} /> Hide in this view
      </button>

      {isSelect && (
        <div className="mt-1 border-t border-[hsl(var(--sb-border))] pt-2">
          <p className="px-1 pb-1 text-[10px] uppercase tracking-wider text-[hsl(var(--sb-text-faint))]">
            Options
          </p>
          <ul className="space-y-1">
            {options.map((o) => (
              <li key={o.id} className="flex items-center gap-1.5">
                <select
                  aria-label={`${o.name} colour`}
                  value={o.color}
                  onChange={(e) =>
                    onOptions(
                      options.map((x) =>
                        x.id === o.id
                          ? { ...x, color: e.target.value as OptionColor }
                          : x,
                      ),
                    )
                  }
                  className={`rounded px-1 py-0.5 text-xs outline-none ${COLOR_CLASSES[o.color]}`}
                >
                  {OPTION_COLORS.map((c) => (
                    <option
                      key={c}
                      value={c}
                      className="bg-[hsl(var(--sb-bg-panel))] text-white"
                    >
                      {c}
                    </option>
                  ))}
                </select>
                <span className="min-w-0 flex-1 truncate text-sm">
                  {o.name}
                </span>
                <button
                  aria-label={`Delete option ${o.name}`}
                  onClick={() =>
                    onOptions(options.filter((x) => x.id !== o.id))
                  }
                  className="rounded p-1 text-[hsl(var(--sb-text-faint))] hover:bg-white/10 hover:text-white"
                >
                  <X size={12} />
                </button>
              </li>
            ))}
          </ul>
          <form
            className="mt-2 flex gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              const n = newOpt.trim();
              if (!n || options.length >= 50) return;
              onOptions([
                ...options,
                {
                  id: slugify(n, new Set(options.map((o) => o.id))),
                  name: n,
                  color: OPTION_COLORS[options.length % OPTION_COLORS.length]!,
                },
              ]);
              setNewOpt("");
            }}
          >
            <input
              aria-label="New option"
              placeholder="Add option"
              value={newOpt}
              onChange={(e) => setNewOpt(e.target.value)}
              className={field}
            />
            <button
              aria-label="Add option"
              className="rounded-md border border-[hsl(var(--sb-border-hover))] px-2 hover:bg-[hsl(var(--sb-bg-hover))]"
            >
              <Plus size={14} />
            </button>
          </form>
        </div>
      )}

      <div className="mt-1 border-t border-[hsl(var(--sb-border))] pt-1">
        <button
          className={`${menuBtn} hover:!text-red-300`}
          onClick={() => {
            onDelete();
            onClose();
          }}
        >
          <Trash2 size={14} /> Delete property
        </button>
      </div>
    </Popover>
  );
}

/** "+" column: create a property. */
export function AddPropertyMenu({
  onClose,
  onAdd,
}: {
  onClose: () => void;
  onAdd: (name: string, type: PropType) => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<PropType>("text");
  return (
    <Popover onClose={onClose} label="Add property">
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          onAdd(name.trim(), type);
          onClose();
        }}
      >
        <input
          autoFocus
          aria-label="New property name"
          placeholder="Property name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={field}
        />
        <select
          aria-label="Property type"
          value={type}
          onChange={(e) => setType(e.target.value as PropType)}
          className={field}
        >
          {(Object.keys(PROP_TYPE_LABELS) as PropType[]).map((t) => (
            <option key={t} value={t} className="bg-[hsl(var(--sb-bg-panel))]">
              {PROP_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
        <button className="w-full rounded-md bg-[hsl(var(--sb-accent))] px-3 py-1.5 text-sm font-medium text-white">
          Add property
        </button>
      </form>
    </Popover>
  );
}
