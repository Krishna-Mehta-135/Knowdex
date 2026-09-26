"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import {
  COLOR_CLASSES,
  type Property,
  type PropValue,
} from "@/lib/databases/types";

interface CellProps {
  prop: Property;
  value: PropValue | undefined;
  onChange: (v: PropValue) => void;
}

const inputCls =
  "w-full min-w-0 rounded bg-transparent px-2 py-1.5 text-sm outline-none focus:bg-white/5 focus:ring-1 focus:ring-[hsl(var(--sb-accent))]/60";

export function Pill({
  name,
  color,
}: {
  name: string;
  color: keyof typeof COLOR_CLASSES;
}) {
  return (
    <span
      className={`inline-flex max-w-full items-center truncate rounded px-1.5 py-0.5 text-xs ${COLOR_CLASSES[color]}`}
    >
      {name}
    </span>
  );
}

/** Text-like input that commits on blur / Enter so typing doesn't PATCH per keystroke. */
function CommitInput({
  value,
  onCommit,
  type = "text",
  label,
}: {
  value: string;
  onCommit: (v: string) => void;
  type?: "text" | "number" | "date" | "url";
  label: string;
}) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const commit = () => v !== value && onCommit(v);
  return (
    <input
      type={type}
      value={v}
      aria-label={label}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setV(value);
          (e.target as HTMLInputElement).blur();
        }
      }}
      className={inputCls}
    />
  );
}

const dateFmt = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

/** Shows a formatted date (or a quiet dash); the native picker only appears on click. */
function DateCell({
  value,
  onCommit,
  label,
}: {
  value: string;
  onCommit: (v: string) => void;
  label: string;
}) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <input
        autoFocus
        type="date"
        aria-label={label}
        defaultValue={value}
        onBlur={(e) => {
          setEditing(false);
          if (e.target.value !== value) onCommit(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") setEditing(false);
        }}
        className={inputCls}
      />
    );
  }
  return (
    <button
      type="button"
      aria-label={value ? `${label}: ${value}` : `Set ${label}`}
      onClick={() => setEditing(true)}
      className="block w-full px-2 py-1.5 text-left text-sm hover:bg-white/5"
    >
      {value ? (
        dateFmt.format(new Date(`${value}T00:00:00Z`))
      ) : (
        <span className="text-xs text-[hsl(var(--sb-text-faint))]">—</span>
      )}
    </button>
  );
}

export function Cell({ prop, value, onChange }: CellProps) {
  const label = prop.name;
  switch (prop.type) {
    case "text":
    case "url":
      return (
        <CommitInput
          type={prop.type === "url" ? "url" : "text"}
          label={label}
          value={typeof value === "string" ? value : ""}
          onCommit={(v) => onChange(v === "" ? null : v)}
        />
      );
    case "date":
      return (
        <DateCell
          label={label}
          value={typeof value === "string" ? value : ""}
          onCommit={(v) => onChange(v === "" ? null : v)}
        />
      );
    case "number":
      return (
        <CommitInput
          type="number"
          label={label}
          value={typeof value === "number" ? String(value) : ""}
          onCommit={(v) => {
            if (v === "") return onChange(null);
            const n = Number(v);
            if (Number.isFinite(n)) onChange(n);
          }}
        />
      );
    case "checkbox":
      return (
        <label className="flex h-full items-center px-2 py-1.5">
          <input
            type="checkbox"
            aria-label={label}
            checked={value === true}
            onChange={(e) => onChange(e.target.checked)}
            className="h-4 w-4 accent-[hsl(var(--sb-accent))]"
          />
        </label>
      );
    case "select": {
      const opt = prop.options?.find((o) => o.id === value);
      return (
        <div className="relative px-2 py-1.5">
          {opt ? (
            <Pill name={opt.name} color={opt.color} />
          ) : (
            <span className="text-xs text-[hsl(var(--sb-text-faint))]">—</span>
          )}
          <select
            aria-label={label}
            value={typeof value === "string" ? value : ""}
            onChange={(e) =>
              onChange(e.target.value === "" ? null : e.target.value)
            }
            className="absolute inset-0 h-full w-full cursor-pointer bg-[hsl(var(--sb-bg-panel))] opacity-0"
          >
            <option value="">No value</option>
            {prop.options?.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </div>
      );
    }
    case "multiselect": {
      const current = Array.isArray(value) ? value : [];
      const remaining =
        prop.options?.filter((o) => !current.includes(o.id)) ?? [];
      return (
        <div className="flex flex-wrap items-center gap-1 px-2 py-1.5">
          {current.map((id) => {
            const o = prop.options?.find((x) => x.id === id);
            if (!o) return null;
            return (
              <span
                key={id}
                className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs ${COLOR_CLASSES[o.color]}`}
              >
                {o.name}
                <button
                  aria-label={`Remove ${o.name}`}
                  onClick={() => onChange(current.filter((c) => c !== id))}
                  className="opacity-60 hover:opacity-100"
                >
                  <X size={10} />
                </button>
              </span>
            );
          })}
          {remaining.length > 0 && (
            <select
              aria-label={`Add ${label}`}
              value=""
              onChange={(e) =>
                e.target.value && onChange([...current, e.target.value])
              }
              className="w-6 cursor-pointer rounded bg-transparent text-xs text-[hsl(var(--sb-text-faint))] outline-none hover:bg-white/5"
            >
              <option value="">＋</option>
              {remaining.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          )}
        </div>
      );
    }
  }
}
