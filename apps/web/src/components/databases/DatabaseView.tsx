"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowDown,
  ArrowUp,
  Kanban,
  Loader2,
  MoreHorizontal,
  Plus,
  Search,
  Table2,
  Trash2,
} from "lucide-react";
import {
  createRow,
  deleteDatabase,
  getDatabase,
  updateDatabase,
  updateRow,
} from "@/lib/databases/api";
import {
  filterRows,
  firstSelectProp,
  groupRows,
  slugify,
  sortRows,
} from "@/lib/databases/view";
import {
  COLOR_CLASSES,
  TITLE_ID,
  type DatabaseMeta,
  type Property,
  type PropType,
  type PropValue,
  type Row,
  type ViewDef,
} from "@/lib/databases/types";
import { Cell } from "./Cell";
import { AddPropertyMenu, PropertyMenu } from "./PropertyMenu";

const COL_W = "min-w-[180px] w-[180px]";

export function DatabaseView({ id }: { id: string }) {
  const router = useRouter();
  const [db, setDb] = useState<DatabaseMeta | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [viewId, setViewId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filterProp, setFilterProp] = useState("");
  const [filterOpt, setFilterOpt] = useState("");
  const [menu, setMenu] = useState<string | null>(null); // property id | "__add"
  const [viewMenu, setViewMenu] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getDatabase(id)
      .then((d) => {
        if (cancelled) return;
        setDb(d.database);
        setRows(d.rows);
        setViewId(d.database.views[0]?.id ?? null);
      })
      .catch(
        (e) =>
          !cancelled &&
          setError(e instanceof Error ? e.message : "Could not load database"),
      );
    return () => {
      cancelled = true;
    };
  }, [id]);

  const view: ViewDef | undefined =
    db?.views.find((v) => v.id === viewId) ?? db?.views[0];
  const schema = useMemo(() => db?.schema ?? [], [db]);

  const saveMeta = useCallback(
    async (patch: {
      name?: string;
      schema?: Property[];
      views?: ViewDef[];
    }) => {
      if (!db) return;
      const prev = db;
      setDb({ ...db, ...patch }); // optimistic
      try {
        await updateDatabase(db.id, patch);
      } catch (e) {
        setDb(prev);
        toast.error(e instanceof Error ? e.message : "Could not save changes");
      }
    },
    [db],
  );

  const patchRow = useCallback(
    async (
      row: Row,
      patch: { title?: string; props?: Record<string, PropValue> },
    ) => {
      const before = row;
      setRows((rs) =>
        rs.map((r) => {
          if (r.id !== row.id) return r;
          const props = { ...r.props, ...patch.props };
          for (const k of Object.keys(props))
            if (props[k] === null) delete props[k];
          return { ...r, title: patch.title ?? r.title, props };
        }),
      );
      try {
        const saved = await updateRow(id, row.id, patch);
        setRows((rs) => rs.map((r) => (r.id === row.id ? saved : r)));
      } catch (e) {
        setRows((rs) => rs.map((r) => (r.id === row.id ? before : r)));
        toast.error(e instanceof Error ? e.message : "Could not save");
      }
    },
    [id],
  );

  const addRow = useCallback(
    async (props?: Record<string, PropValue>) => {
      try {
        const row = await createRow(id, { props });
        setRows((rs) => [...rs, row]);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not add row");
      }
    },
    [id],
  );

  const visible = useMemo(() => {
    if (!view) return rows;
    const filtered = filterRows(rows, schema, {
      query,
      select: filterProp && filterOpt ? { [filterProp]: filterOpt } : {},
    });
    return sortRows(filtered, schema, view.sort);
  }, [rows, schema, view, query, filterProp, filterOpt]);

  if (error) return <p className="p-8 text-sm text-red-300">{error}</p>;
  if (!db || !view)
    return (
      <p className="flex items-center gap-2 p-8 text-sm text-[hsl(var(--sb-text-muted))]">
        <Loader2 size={14} className="animate-spin" /> Loading…
      </p>
    );

  const setView = (patch: Partial<ViewDef>) =>
    void saveMeta({
      views: db.views.map((v) => (v.id === view.id ? { ...v, ...patch } : v)),
    });

  const addProperty = (name: string, type: PropType) => {
    const taken = new Set(schema.map((p) => p.id));
    const prop: Property = {
      id: slugify(name, taken),
      name,
      type,
      ...(type === "select" || type === "multiselect" ? { options: [] } : {}),
    };
    void saveMeta({ schema: [...schema, prop] });
  };

  const deleteProperty = (p: Property) => {
    const views = db.views
      .map((v) =>
        v.groupBy === p.id
          ? { ...v, type: "table" as const, groupBy: undefined }
          : v,
      )
      .map((v) => ({
        ...v,
        sort: v.sort?.propId === p.id ? undefined : v.sort,
        hidden: v.hidden?.filter((h) => h !== p.id),
      }));
    void saveMeta({ schema: schema.filter((x) => x.id !== p.id), views });
  };

  const addView = (type: "table" | "board") => {
    const group = firstSelectProp(schema);
    if (type === "board" && !group) {
      toast.error("Add a select property first — boards group cards by it.");
      return;
    }
    const taken = new Set(db.views.map((v) => v.id));
    const nv: ViewDef = {
      id: slugify(type, taken),
      name: type === "board" ? "Board" : "Table",
      type,
      ...(type === "board" ? { groupBy: group!.id } : {}),
    };
    void saveMeta({ views: [...db.views, nv] });
    setViewId(nv.id);
  };

  const removeView = () => {
    if (db.views.length <= 1) return;
    const rest = db.views.filter((v) => v.id !== view.id);
    void saveMeta({ views: rest });
    setViewId(rest[0]!.id);
  };

  const selectProps = schema.filter(
    (p) => p.type === "select" || p.type === "multiselect",
  );
  const filterOptions =
    selectProps.find((p) => p.id === filterProp)?.options ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-[hsl(var(--sb-border))] px-4 py-2">
        <input
          aria-label="Database name"
          defaultValue={db.name}
          key={db.name}
          onBlur={(e) =>
            e.target.value.trim() &&
            e.target.value.trim() !== db.name &&
            void saveMeta({ name: e.target.value.trim() })
          }
          onKeyDown={(e) =>
            e.key === "Enter" && (e.target as HTMLInputElement).blur()
          }
          className="min-w-0 max-w-xs rounded bg-transparent px-1 text-lg font-semibold outline-none focus:bg-white/5"
        />
        <div role="tablist" className="ml-2 flex items-center gap-1">
          {db.views.map((v) => (
            <button
              key={v.id}
              role="tab"
              aria-selected={v.id === view.id}
              onClick={() => setViewId(v.id)}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs ${v.id === view.id ? "bg-[hsl(var(--sb-accent))]/20 text-white" : "text-[hsl(var(--sb-text-muted))] hover:bg-[hsl(var(--sb-bg-hover))]"}`}
            >
              {v.type === "board" ? <Kanban size={13} /> : <Table2 size={13} />}{" "}
              {v.name}
            </button>
          ))}
          <div className="relative">
            <button
              aria-label="Add view"
              aria-haspopup="menu"
              aria-expanded={viewMenu}
              onClick={() => setViewMenu((v) => !v)}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-[hsl(var(--sb-text-faint))] hover:bg-[hsl(var(--sb-bg-hover))] hover:text-white"
            >
              <Plus size={12} /> View
            </button>
            {viewMenu && (
              <>
                <div
                  className="fixed inset-0 z-30"
                  onClick={() => setViewMenu(false)}
                />
                <div
                  role="menu"
                  className="absolute left-0 top-full z-40 mt-1 w-40 rounded-xl border border-[hsl(var(--sb-border))] bg-[hsl(var(--sb-bg-panel))] p-1 shadow-2xl"
                >
                  {(["table", "board"] as const).map((t) => (
                    <button
                      key={t}
                      role="menuitem"
                      onClick={() => {
                        setViewMenu(false);
                        addView(t);
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-[hsl(var(--sb-text-muted))] hover:bg-[hsl(var(--sb-bg-hover))] hover:text-white"
                    >
                      {t === "table" ? (
                        <Table2 size={14} />
                      ) : (
                        <Kanban size={14} />
                      )}{" "}
                      {t === "table" ? "Table" : "Board"}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          {db.views.length > 1 && (
            <button
              aria-label="Delete this view"
              title="Delete this view"
              onClick={removeView}
              className="rounded p-1 text-[hsl(var(--sb-text-faint))] hover:bg-[hsl(var(--sb-bg-hover))]"
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2 text-xs">
          <label className="flex items-center gap-1.5 rounded-md border border-[hsl(var(--sb-border))] px-2 py-1">
            <Search size={12} className="text-[hsl(var(--sb-text-faint))]" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search"
              aria-label="Search rows"
              className="w-28 bg-transparent outline-none"
            />
          </label>
          {selectProps.length > 0 && (
            <>
              <select
                aria-label="Filter property"
                value={filterProp}
                onChange={(e) => {
                  setFilterProp(e.target.value);
                  setFilterOpt("");
                }}
                className="rounded-md border border-[hsl(var(--sb-border))] bg-transparent px-1.5 py-1 outline-none"
              >
                <option value="">Filter…</option>
                {selectProps.map((p) => (
                  <option
                    key={p.id}
                    value={p.id}
                    className="bg-[hsl(var(--sb-bg-panel))]"
                  >
                    {p.name}
                  </option>
                ))}
              </select>
              {filterProp && (
                <select
                  aria-label="Filter value"
                  value={filterOpt}
                  onChange={(e) => setFilterOpt(e.target.value)}
                  className="rounded-md border border-[hsl(var(--sb-border))] bg-transparent px-1.5 py-1 outline-none"
                >
                  <option value="">Any</option>
                  <option
                    value="__none"
                    className="bg-[hsl(var(--sb-bg-panel))]"
                  >
                    No value
                  </option>
                  {filterOptions.map((o) => (
                    <option
                      key={o.id}
                      value={o.id}
                      className="bg-[hsl(var(--sb-bg-panel))]"
                    >
                      {o.name}
                    </option>
                  ))}
                </select>
              )}
            </>
          )}
          <button
            aria-label="Delete database"
            title="Delete database (notes are kept)"
            onClick={async () => {
              if (
                !window.confirm(
                  `Delete "${db.name}"? Its ${rows.length} notes are kept as regular notes.`,
                )
              )
                return;
              await deleteDatabase(db.id);
              router.push("/databases");
            }}
            className="rounded p-1.5 text-[hsl(var(--sb-text-faint))] hover:bg-[hsl(var(--sb-bg-hover))] hover:text-red-300"
          >
            <MoreHorizontal size={14} />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto custom-scrollbar">
        {view.type === "board" ? (
          <Board
            db={db}
            view={view}
            rows={visible}
            onMove={(row, key) =>
              void patchRow(row, { props: { [view.groupBy!]: key } })
            }
            onAdd={(key) =>
              void addRow(key ? { [view.groupBy!]: key } : undefined)
            }
          />
        ) : (
          <TableGrid
            db={db}
            view={view}
            rows={visible}
            menu={menu}
            setMenu={setMenu}
            onCell={(row, propId, v) =>
              void patchRow(row, { props: { [propId]: v } })
            }
            onTitle={(row, title) => void patchRow(row, { title })}
            onAddRow={() => void addRow()}
            onRename={(p, name) =>
              void saveMeta({
                schema: schema.map((x) => (x.id === p.id ? { ...x, name } : x)),
              })
            }
            onSort={(p, dir) => setView({ sort: { propId: p.id, dir } })}
            onHide={(p) => setView({ hidden: [...(view.hidden ?? []), p.id] })}
            onDelete={deleteProperty}
            onOptions={(p, options) =>
              void saveMeta({
                schema: schema.map((x) =>
                  x.id === p.id ? { ...x, options } : x,
                ),
              })
            }
            onAddProperty={addProperty}
            onSortTitle={() =>
              setView({
                sort:
                  view.sort?.propId === TITLE_ID && view.sort.dir === "asc"
                    ? { propId: TITLE_ID, dir: "desc" }
                    : { propId: TITLE_ID, dir: "asc" },
              })
            }
            onShowAll={() => setView({ hidden: [] })}
          />
        )}
      </div>
    </div>
  );
}

function TableGrid(props: {
  db: DatabaseMeta;
  view: ViewDef;
  rows: Row[];
  menu: string | null;
  setMenu: (m: string | null) => void;
  onCell: (row: Row, propId: string, v: PropValue) => void;
  onTitle: (row: Row, title: string) => void;
  onAddRow: () => void;
  onRename: (p: Property, name: string) => void;
  onSort: (p: Property, dir: "asc" | "desc") => void;
  onHide: (p: Property) => void;
  onDelete: (p: Property) => void;
  onOptions: (p: Property, o: NonNullable<Property["options"]>) => void;
  onAddProperty: (name: string, type: PropType) => void;
  onSortTitle: () => void;
  onShowAll: () => void;
}) {
  const { db, view, rows, menu, setMenu } = props;
  const hidden = new Set(view.hidden ?? []);
  const cols = db.schema.filter((p) => !hidden.has(p.id));
  const sortDir = (id: string) =>
    view.sort?.propId === id ? view.sort.dir : null;
  const SortIcon = ({ id }: { id: string }) =>
    sortDir(id) === "asc" ? (
      <ArrowUp size={11} />
    ) : sortDir(id) === "desc" ? (
      <ArrowDown size={11} />
    ) : null;

  return (
    <div
      role="table"
      aria-label={db.name}
      className="inline-block min-w-full text-sm"
    >
      <div
        role="row"
        className="sticky top-0 z-10 flex border-b border-[hsl(var(--sb-border))] bg-[hsl(var(--sb-bg-panel))] text-xs text-[hsl(var(--sb-text-muted))]"
      >
        <button
          role="columnheader"
          onClick={props.onSortTitle}
          className="flex min-w-[260px] w-[260px] items-center gap-1 px-3 py-2 text-left hover:bg-[hsl(var(--sb-bg-hover))]"
        >
          Name <SortIcon id={TITLE_ID} />
        </button>
        {cols.map((p) => (
          <div key={p.id} role="columnheader" className={`relative ${COL_W}`}>
            <button
              onClick={() => setMenu(menu === p.id ? null : p.id)}
              className="flex w-full items-center gap-1 px-3 py-2 text-left hover:bg-[hsl(var(--sb-bg-hover))]"
            >
              <span className="truncate">{p.name}</span> <SortIcon id={p.id} />
            </button>
            {menu === p.id && (
              <PropertyMenu
                prop={p}
                onClose={() => setMenu(null)}
                onRename={(n) => props.onRename(p, n)}
                onSort={(d) => props.onSort(p, d)}
                onHide={() => props.onHide(p)}
                onDelete={() => props.onDelete(p)}
                onOptions={(o) => props.onOptions(p, o)}
              />
            )}
          </div>
        ))}
        <div className="relative">
          <button
            aria-label="Add property"
            onClick={() => setMenu(menu === "__add" ? null : "__add")}
            className="px-3 py-2 hover:bg-[hsl(var(--sb-bg-hover))]"
          >
            <Plus size={14} />
          </button>
          {menu === "__add" && (
            <AddPropertyMenu
              onClose={() => setMenu(null)}
              onAdd={props.onAddProperty}
            />
          )}
        </div>
        {hidden.size > 0 && (
          <button
            onClick={props.onShowAll}
            className="px-3 py-2 text-[hsl(var(--sb-accent))] hover:underline"
          >
            {hidden.size} hidden · show
          </button>
        )}
      </div>

      {rows.map((row) => (
        <div
          key={row.id}
          role="row"
          className="group flex border-b border-[hsl(var(--sb-border))] hover:bg-white/[0.02]"
        >
          <div
            role="cell"
            className="flex min-w-[260px] w-[260px] items-center"
          >
            <TitleCell row={row} onCommit={(t) => props.onTitle(row, t)} />
            <Link
              href={`/documents/${row.id}`}
              className="mr-2 shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase text-[hsl(var(--sb-text-faint))] no-underline opacity-0 hover:bg-white/10 hover:text-white group-hover:opacity-100"
            >
              Open
            </Link>
          </div>
          {cols.map((p) => (
            <div
              key={p.id}
              role="cell"
              className={`${COL_W} border-l border-[hsl(var(--sb-border))]`}
            >
              <Cell
                prop={p}
                value={row.props[p.id]}
                onChange={(v) => props.onCell(row, p.id, v)}
              />
            </div>
          ))}
        </div>
      ))}
      <button
        onClick={props.onAddRow}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-[hsl(var(--sb-text-muted))] hover:bg-[hsl(var(--sb-bg-hover))]"
      >
        <Plus size={13} /> New row
      </button>
      {rows.length === 0 && (
        <p className="px-3 py-6 text-xs text-[hsl(var(--sb-text-faint))]">
          No rows match. Add one, or clear the search and filters.
        </p>
      )}
    </div>
  );
}

function TitleCell({
  row,
  onCommit,
}: {
  row: Row;
  onCommit: (t: string) => void;
}) {
  const [v, setV] = useState(row.title);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => setV(row.title), [row.title]);
  return (
    <input
      ref={ref}
      aria-label="Row title"
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() =>
        v.trim() && v.trim() !== row.title
          ? onCommit(v.trim())
          : setV(row.title)
      }
      onKeyDown={(e) => e.key === "Enter" && ref.current?.blur()}
      className="min-w-0 flex-1 rounded bg-transparent px-3 py-1.5 text-sm font-medium outline-none focus:bg-white/5"
    />
  );
}

function Board({
  db,
  view,
  rows,
  onMove,
  onAdd,
}: {
  db: DatabaseMeta;
  view: ViewDef;
  rows: Row[];
  onMove: (row: Row, key: string | null) => void;
  onAdd: (key: string | null) => void;
}) {
  const prop = db.schema.find((p) => p.id === view.groupBy);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  if (!prop)
    return (
      <p className="p-6 text-sm text-[hsl(var(--sb-text-muted))]">
        This board’s group-by property was deleted. Pick another view.
      </p>
    );
  const groups = groupRows(rows, prop);
  const cardProps = db.schema
    .filter((p) => p.id !== prop.id && p.type !== "text")
    .slice(0, 3);

  return (
    <div className="flex h-full items-start gap-3 overflow-x-auto p-4">
      {groups.map((g) => {
        const gk = g.key ?? "__none";
        return (
          <section
            key={gk}
            aria-label={g.name}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(gk);
            }}
            onDragLeave={() => setOver((o) => (o === gk ? null : o))}
            onDrop={(e) => {
              e.preventDefault();
              setOver(null);
              const row = rows.find(
                (r) =>
                  r.id === (dragId ?? e.dataTransfer.getData("text/plain")),
              );
              setDragId(null);
              if (row && (row.props[prop.id] ?? null) !== g.key)
                onMove(row, g.key);
            }}
            className={`flex max-h-full w-72 shrink-0 flex-col rounded-xl border bg-[hsl(var(--sb-bg-panel))] p-2 ${over === gk ? "border-[hsl(var(--sb-accent))]" : "border-[hsl(var(--sb-border))]"}`}
          >
            <header className="mb-2 flex items-center gap-2 px-1 text-xs">
              <span
                className={`rounded px-1.5 py-0.5 ${COLOR_CLASSES[g.color]}`}
              >
                {g.name}
              </span>
              <span className="text-[hsl(var(--sb-text-faint))]">
                {g.rows.length}
              </span>
            </header>
            <ul className="min-h-[24px] flex-1 space-y-2 overflow-y-auto">
              {g.rows.map((r) => (
                <li
                  key={r.id}
                  draggable
                  onDragStart={(e) => {
                    setDragId(r.id);
                    e.dataTransfer.setData("text/plain", r.id);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onDragEnd={() => setDragId(null)}
                  className={`cursor-grab rounded-lg border border-[hsl(var(--sb-border))] bg-[hsl(var(--sb-bg))] p-3 ${dragId === r.id ? "opacity-40" : ""}`}
                >
                  <Link
                    href={`/documents/${r.id}`}
                    className="text-sm font-medium text-white no-underline hover:underline"
                  >
                    {r.title}
                  </Link>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1 text-xs text-[hsl(var(--sb-text-muted))]">
                    {cardProps.map((p) => (
                      <CardValue key={p.id} prop={p} value={r.props[p.id]} />
                    ))}
                  </div>
                </li>
              ))}
            </ul>
            <button
              onClick={() => onAdd(g.key)}
              className="mt-2 flex items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs text-[hsl(var(--sb-text-muted))] hover:bg-[hsl(var(--sb-bg-hover))]"
            >
              <Plus size={12} /> New
            </button>
          </section>
        );
      })}
    </div>
  );
}

function CardValue({
  prop,
  value,
}: {
  prop: Property;
  value: PropValue | undefined;
}) {
  if (
    value === null ||
    value === undefined ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  )
    return null;
  if (prop.type === "select") {
    const o = prop.options?.find((x) => x.id === value);
    return o ? (
      <span className={`rounded px-1.5 py-0.5 ${COLOR_CLASSES[o.color]}`}>
        {o.name}
      </span>
    ) : null;
  }
  if (prop.type === "multiselect") {
    return (
      <>
        {(value as string[]).map((id) => {
          const o = prop.options?.find((x) => x.id === id);
          return o ? (
            <span
              key={id}
              className={`rounded px-1.5 py-0.5 ${COLOR_CLASSES[o.color]}`}
            >
              {o.name}
            </span>
          ) : null;
        })}
      </>
    );
  }
  if (prop.type === "checkbox")
    return value ? <span>✓ {prop.name}</span> : null;
  return <span>{prop.type === "date" ? `📅 ${value}` : String(value)}</span>;
}
