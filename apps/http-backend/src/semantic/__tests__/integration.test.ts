/**
 * Integration test against a real Postgres. Runs only when TEST_DATABASE_URL is
 * set (never point it at a shared/production database — it creates & deletes rows).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as Y from "yjs";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const DB = process.env.TEST_DATABASE_URL;
const d = DB ? describe : describe.skip;

/** Smallest valid-enough PDF with one line of text (pdf.js rebuilds a missing xref). */
function tinyPdf(text: string): Buffer {
  const stream = `BT /F1 18 Tf 40 100 Td (${text}) Tj ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out +=
    `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` +
    offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, "latin1");
}

function state(paragraphs: string[], wiki?: string) {
  const doc = new Y.Doc();
  const frag = doc.getXmlFragment("content");
  for (const p of paragraphs) {
    const el = new Y.XmlElement("paragraph");
    const t = new Y.XmlText();
    t.insert(0, p);
    el.insert(0, [t]);
    frag.push([el]);
  }
  if (wiki) {
    const el = new Y.XmlElement("paragraph");
    const w = new Y.XmlElement("wikiLink");
    w.setAttribute("title", wiki);
    el.insert(0, [w]);
    frag.push([el]);
  }
  return Buffer.from(Y.encodeStateAsUpdate(doc));
}

d("semantic API (real db)", () => {
  let server: Server;
  let base = "";
  let token = "";
  let otherToken = "";
  let wid = "";
  const ids: Record<string, string> = {};
  const importedIds: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  const suffix = Math.random().toString(36).slice(2, 8);

  const api = (path: string, init: RequestInit = {}, tk = token) =>
    fetch(`${base}/api/v1/kx${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${tk}`, ...(init.headers ?? {}) },
    });
  const json = (path: string, body: unknown, tk = token) =>
    api(
      path,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      tk,
    );

  beforeAll(async () => {
    process.env.DATABASE_URL = DB;
    process.env.JWT_SECRET = "test-secret";
    process.env.GEMINI_API_KEY = ""; // force local embedder + extractive answers
    const jwt = (await import("jsonwebtoken")).default;
    ({ prisma } = await import("@repo/db"));
    const { app } = await import("../../app.js");
    const { sweepIndex } = await import("../indexer.js");
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const u1 = await prisma.user.create({
      data: { username: `t1${suffix}`, email: `t1${suffix}@x.io` },
    });
    const u2 = await prisma.user.create({
      data: { username: `t2${suffix}`, email: `t2${suffix}@x.io` },
    });
    token = jwt.sign({ id: u1.id }, "test-secret");
    otherToken = jwt.sign({ id: u2.id }, "test-secret");
    const ws = await prisma.workspace.create({
      data: {
        name: "T",
        slug: `t-${suffix}`,
        ownerId: u1.id,
        members: { create: { userId: u1.id, role: "owner" } },
      },
    });
    wid = ws.id;

    const notes: Array<[string, string, string[], string?]> = [
      [
        "graphs",
        "Knowledge Graphs",
        [
          "A knowledge graph links notes together so ideas connect and relationships between notes become visible.",
        ],
        "Linking Notes",
      ],
      [
        "linking",
        "Linking Notes",
        [
          "Linking notes with wiki links builds a knowledge graph. Connected notes surface related ideas and relationships.",
        ],
      ],
      [
        "cake",
        "Chocolate Cake",
        [
          "Bake the chocolate cake with butter, sugar, flour and cocoa. Cool the cake before frosting.",
        ],
      ],
      [
        "cake2",
        "Cake Frosting",
        [
          "Frosting for a chocolate cake needs butter, sugar and cocoa. Spread frosting after the cake cools.",
        ],
      ],
    ];
    for (const [key, title, paras, wiki] of notes) {
      const c = await prisma.content.create({
        data: {
          title,
          link: "x",
          type: "document",
          userId: u1.id,
          workspaceId: wid,
        },
      });
      ids[key] = c.id;
      await prisma.document.create({
        data: { id: c.id, state: state(paras, wiki) },
      });
    }
    await prisma.documentLink.create({
      data: { fromDocId: ids.graphs!, toDocId: ids.linking! },
    });
    while ((await sweepIndex(50)) > 0) {
      /* drain */
    }
  }, 60_000);

  afterAll(async () => {
    if (!prisma) return;
    await prisma.docChunk.deleteMany({ where: { workspaceId: wid } });
    await prisma.docIndexState.deleteMany({
      where: { sourceId: { in: Object.values(ids) } },
    });
    await prisma.attachment.deleteMany({ where: { workspaceId: wid } });
    await prisma.documentLink.deleteMany({
      where: { fromDocId: { in: Object.values(ids) } },
    });
    await prisma.document.deleteMany({
      where: { id: { in: Object.values(ids) } },
    });
    await prisma.content.deleteMany({ where: { workspaceId: wid } });
    await prisma.workspace.deleteMany({ where: { id: wid } });
    await prisma.user.deleteMany({
      where: { username: { in: [`t1${suffix}`, `t2${suffix}`] } },
    });
    server?.close();
  });

  it("indexes every note", async () => {
    const r = await (await api(`/workspaces/${wid}/index-status`)).json();
    expect(r.data.indexed).toBe(4);
  });

  it("graph returns real edges and ghost edges (unlinked similar pair only)", async () => {
    const r = await (await api(`/workspaces/${wid}/graph`)).json();
    expect(r.data.nodes).toHaveLength(4);
    expect(r.data.edges).toEqual([{ a: ids.graphs, b: ids.linking }]);
    const ghost = r.data.ghostEdges.map((e: { a: string; b: string }) =>
      [e.a, e.b].sort().join("|"),
    );
    expect(ghost).toContain([ids.cake, ids.cake2].sort().join("|"));
    expect(ghost).not.toContain([ids.graphs, ids.linking].sort().join("|"));
  });

  it("related notes rank the topical neighbour first", async () => {
    const r = await (await api(`/documents/${ids.cake}/related`)).json();
    expect(r.data[0].id).toBe(ids.cake2);
    expect(
      r.data.find((x: { id: string }) => x.id === ids.graphs),
    ).toBeUndefined();
  });

  it("semantic search finds the right note", async () => {
    const r = await (
      await json(`/workspaces/${wid}/search`, {
        query: "how do I bake with cocoa and butter",
      })
    ).json();
    expect(["Chocolate Cake", "Cake Frosting"]).toContain(r.data[0].title);
  });

  it("unlinked mentions finds notes naming a title without linking", async () => {
    // "Chocolate Cake" title is mentioned in "Cake Frosting" body text ("chocolate cake needs")
    const r = await (
      await api(`/documents/${ids.cake}/unlinked-mentions`)
    ).json();
    expect(r.data.map((x: { id: string }) => x.id)).toContain(ids.cake2);
  });

  it("ask streams sources then tokens then done (extractive without a key)", async () => {
    const res = await json(`/workspaces/${wid}/ask`, {
      question: "How do I make frosting?",
    });
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
    const body = await res.text();
    expect(body).toContain("event: sources");
    expect(body).toContain("event: token");
    expect(body).toContain("event: done");
    expect(body).toContain("Cake Frosting");
  });

  it("denies non-members", async () => {
    expect((await api(`/workspaces/${wid}/graph`, {}, otherToken)).status).toBe(
      403,
    );
    expect(
      (await json(`/workspaces/${wid}/ask`, { question: "hi" }, otherToken))
        .status,
    ).toBe(403);
    expect(
      (await api(`/documents/${ids.cake}/related`, {}, otherToken)).status,
    ).toBe(403);
  });

  it("rejects unauthenticated requests", async () => {
    const r = await fetch(`${base}/api/v1/kx/workspaces/${wid}/graph`);
    expect(r.status).toBe(401);
  });

  it("uploads, serves and deletes a text attachment, and indexes it", async () => {
    const up = await api(`/attachments?docId=${ids.cake}&name=notes.txt`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "Sourdough starter needs flour and water and daily feeding.",
    });
    expect(up.status).toBe(201);
    const att = (await up.json()).data;
    const dl = await api(`/attachments/${att.id}`);
    expect(dl.status).toBe(200);
    expect(await dl.text()).toContain("Sourdough");
    expect((await api(`/attachments/${att.id}`, {}, otherToken)).status).toBe(
      403,
    );
    await new Promise((r) => setTimeout(r, 500));
    const s = await (
      await json(`/workspaces/${wid}/search`, {
        query: "sourdough starter feeding",
      })
    ).json();
    expect(s.data[0].kind).toBe("file");
    expect(
      (await api(`/attachments/${att.id}`, { method: "DELETE" })).status,
    ).toBe(200);
    expect((await api(`/attachments/${att.id}`)).status).toBe(404);
  });

  it("uploads a real PDF, extracts its text and makes it searchable + citable", async () => {
    const pdf = tinyPdf(
      "Quarterly telescope calibration procedure for the observatory",
    );
    const up = await api(
      `/attachments?docId=${ids.graphs}&name=calibration.pdf`,
      {
        method: "POST",
        headers: { "Content-Type": "application/pdf" },
        body: new Uint8Array(pdf),
      },
    );
    expect(up.status).toBe(201);
    const att = (await up.json()).data;
    expect(att.hasText).toBe(true);
    await new Promise((r) => setTimeout(r, 800));
    const s = await (
      await json(`/workspaces/${wid}/search`, {
        query: "telescope calibration observatory",
      })
    ).json();
    expect(s.data[0]).toMatchObject({
      kind: "file",
      title: "calibration.pdf",
      id: ids.graphs,
    });
    const ask = await (
      await json(`/workspaces/${wid}/ask`, {
        question: "How is the telescope calibrated?",
      })
    ).text();
    expect(ask).toContain("calibration.pdf");
    const g = await (await api(`/workspaces/${wid}/graph`)).json();
    expect(
      g.data.nodes.find((n: { id: string }) => n.id === att.id),
    ).toMatchObject({ kind: "file", parentId: ids.graphs });
    const dl = await api(`/attachments/${att.id}`);
    expect(dl.headers.get("content-type")).toBe("application/pdf");
    expect(dl.headers.get("content-security-policy")).toBeNull(); // PDF viewer must not be sandboxed
    await api(`/attachments/${att.id}`, { method: "DELETE" });
  });

  it("rejects bad uploads", async () => {
    const exe = await api(`/attachments?docId=${ids.cake}&name=x.exe`, {
      method: "POST",
      headers: { "Content-Type": "application/x-msdownload" },
      body: "MZ",
    });
    expect(exe.status).toBe(415);
    const fakePdf = await api(`/attachments?docId=${ids.cake}&name=x.pdf`, {
      method: "POST",
      headers: { "Content-Type": "application/pdf" },
      body: "not a pdf",
    });
    expect(fakePdf.status).toBe(400);
  });

  it("imports markdown: creates notes, tags, folders, backlinks, and indexes them", async () => {
    const res = await json(`/import`, {
      workspaceId: wid,
      files: [
        {
          path: "Vault/Sub/Espresso.md",
          markdown:
            "---\ntags: [coffee]\n---\n# Espresso\n\nEspresso needs fine grounds and pressure. See [[Grinders]] and [[Chocolate Cake]].\n\n- [ ] buy beans",
        },
        {
          path: "Vault/Grinders.md",
          markdown:
            "Burr grinders give consistent grounds for espresso and filter coffee.",
        },
      ],
    });
    expect(res.status).toBe(201);
    const body = (await res.json()).data;
    expect(body.created.map((c: { title: string }) => c.title).sort()).toEqual([
      "Espresso",
      "Grinders",
    ]);
    expect(body.failed).toEqual([]);
    expect(body.links).toBe(2); // Grinders (new) + Chocolate Cake (existing)
    for (const c of body.created) importedIds.push(c.id);

    const esp = await prisma.content.findFirst({
      where: { workspaceId: wid, title: "Espresso" },
      include: { tags: true },
    });
    expect(esp.folderPath).toBe("Vault / Sub");
    expect(esp.tags.map((t: { name: string }) => t.name)).toEqual(["coffee"]);
    const links = await prisma.documentLink.findMany({
      where: { fromDocId: esp.id },
    });
    expect(links).toHaveLength(2);

    const { sweepIndex } = await import("../indexer.js");
    while ((await sweepIndex(50)) > 0) {
      /* drain */
    }
    const s = await (
      await json(`/workspaces/${wid}/search`, {
        query: "burr grinder coffee grounds",
      })
    ).json();
    expect(s.data.map((x: { title: string }) => x.title)).toContain("Grinders");
    const g = await (await api(`/workspaces/${wid}/graph`)).json();
    expect(
      g.data.edges.some((e: { a: string; b: string }) => e.a === esp.id),
    ).toBe(true);
  });

  it("import validates payload and membership", async () => {
    expect(
      (await json(`/import`, { workspaceId: wid, files: [] })).status,
    ).toBe(400);
    expect(
      (
        await json(`/import`, {
          workspaceId: "nope",
          files: [{ path: "a.md", markdown: "x" }],
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await json(
          `/import`,
          { workspaceId: wid, files: [{ path: "a.md", markdown: "x" }] },
          otherToken,
        )
      ).status,
    ).toBe(403);
    expect(
      (await fetch(`${base}/api/v1/kx/import`, { method: "POST" })).status,
    ).toBe(401);
  });

  it("clipper blocks private/loopback URLs (SSRF)", async () => {
    for (const url of [
      "http://127.0.0.1:8000/",
      "http://localhost/",
      "http://169.254.169.254/latest/meta-data",
      "file:///etc/passwd",
    ]) {
      const r = await json(`/clip`, { url });
      expect(r.status, url).toBe(400);
    }
  });
});
