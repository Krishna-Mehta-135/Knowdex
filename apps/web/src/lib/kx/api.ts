/** Thin client for the /api/kx proxy. All responses are `{ data }` envelopes. */
export async function kx<T>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(`/api/kx/${path}`, {
    credentials: "include",
    ...rest,
    headers: {
      ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(rest.headers ?? {}),
    },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const body = (await res.json().catch(() => ({}))) as {
    data?: T;
    message?: string;
    error?: string;
  };
  if (!res.ok)
    throw new Error(body.message ?? body.error ?? `HTTP ${res.status}`);
  return body.data as T;
}

export interface GraphNode {
  id: string;
  kind: "note" | "file";
  title: string;
  tags: string[];
  folderPath: string;
  createdAt: number;
  updatedAt: number;
  degree: number;
  parentId?: string | null;
}
export interface GraphData {
  nodes: GraphNode[];
  edges: { a: string; b: string }[];
  ghostEdges: { a: string; b: string; score: number }[];
}

export interface AskSource {
  n: number;
  sourceId: string;
  sourceType: string;
  title: string;
  snippet: string;
  score: number;
}

export interface SearchHit {
  id: string;
  title: string;
  kind: "note" | "file";
  snippet: string;
  score: number;
}

export interface RelatedNote {
  id: string;
  title: string;
  score: number;
  linked: boolean;
}

export interface UnlinkedMention {
  id: string;
  title: string;
  snippet: string;
}

/** Stream an answer over SSE. Resolves when the stream closes. */
export async function askWorkspace(
  workspaceId: string,
  question: string,
  handlers: {
    onSources: (s: AskSource[]) => void;
    onToken: (t: string) => void;
    onDone: (mode: string) => void;
    onError: (m: string) => void;
  },
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`/api/kx/workspaces/${workspaceId}/ask`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question }),
    signal,
  });
  if (!res.ok || !res.body) {
    handlers.onError(`Request failed (${res.status})`);
    return;
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n\n")) !== -1) {
      const frame = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const ev = /^event: (.+)$/m.exec(frame)?.[1];
      const dataLine = /^data: (.+)$/m.exec(frame)?.[1];
      if (!ev || !dataLine) continue;
      const data = JSON.parse(dataLine) as Record<string, unknown>;
      if (ev === "sources") handlers.onSources(data as unknown as AskSource[]);
      else if (ev === "token") handlers.onToken(String(data.text ?? ""));
      else if (ev === "done") handlers.onDone(String(data.mode ?? ""));
      else if (ev === "error")
        handlers.onError(String(data.message ?? "error"));
    }
  }
}
