import { kx } from "@/lib/kx/api";
import type { DatabaseMeta, Property, PropValue, Row, ViewDef } from "./types";

const json = (method: string, body: unknown) => ({ method, json: body });

export const listDatabases = (wid: string) =>
  kx<DatabaseMeta[]>(`workspaces/${wid}/databases`);

export const createDatabase = (
  wid: string,
  name: string,
  template: "blank" | "tasks" | "reading",
) =>
  kx<DatabaseMeta>(
    `workspaces/${wid}/databases`,
    json("POST", { name, template }),
  );

export const getDatabase = (id: string) =>
  kx<{ database: DatabaseMeta; rows: Row[] }>(`databases/${id}`);

export const updateDatabase = (
  id: string,
  patch: {
    name?: string;
    icon?: string;
    schema?: Property[];
    views?: ViewDef[];
  },
) => kx<DatabaseMeta>(`databases/${id}`, json("PATCH", patch));

export const deleteDatabase = (id: string) =>
  kx<null>(`databases/${id}`, { method: "DELETE" });

export const createRow = (
  id: string,
  body: { title?: string; props?: Record<string, PropValue> },
) => kx<Row>(`databases/${id}/rows`, json("POST", body));

export const updateRow = (
  id: string,
  rowId: string,
  body: { title?: string; props?: Record<string, PropValue> },
) => kx<Row>(`databases/${id}/rows/${rowId}`, json("PATCH", body));
