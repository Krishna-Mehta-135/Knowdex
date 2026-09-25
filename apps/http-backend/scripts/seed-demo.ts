/**
 * Seed a local database with an interlinked demo workspace.
 *   DATABASE_URL=postgresql://...localhost... npx tsx scripts/seed-demo.ts demo@knowdex.dev
 * Refuses to run against non-local databases.
 */
import "../src/env.js";
import * as Y from "yjs";
import { prisma } from "@repo/db";

const url = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
  console.error("Refusing to seed a non-local database.");
  process.exit(1);
}

type Note = {
  title: string;
  body: string[];
  links?: string[];
  tags?: string[];
};

const notes: Note[] = [
  {
    title: "Knowledge Graphs",
    body: [
      "A knowledge graph connects notes so ideas link together and relationships between concepts become visible.",
      "Graph views help discover clusters of related notes.",
    ],
    links: ["Zettelkasten", "Linking Notes"],
    tags: ["pkm"],
  },
  {
    title: "Linking Notes",
    body: [
      "Linking notes with wiki links builds a network of connected ideas. Backlinks show where a note is referenced.",
    ],
    links: ["Knowledge Graphs"],
    tags: ["pkm"],
  },
  {
    title: "Zettelkasten",
    body: [
      "The Zettelkasten method stores atomic notes and links them, growing a knowledge network over time. Each note holds one idea.",
    ],
    tags: ["pkm"],
  },
  {
    title: "Spaced Repetition",
    body: [
      "Spaced repetition schedules review of flashcards at growing intervals to strengthen memory and long term learning.",
    ],
    tags: ["learning"],
  },
  {
    title: "Active Recall",
    body: [
      "Active recall means testing yourself instead of rereading. Flashcards and practice questions strengthen memory and learning.",
    ],
    tags: ["learning"],
  },
  {
    title: "Sourdough Bread",
    body: [
      "Sourdough bread needs a starter of flour and water, fed daily. Fold the dough, proof overnight, bake in a hot dutch oven.",
    ],
    tags: ["cooking"],
  },
  {
    title: "Pizza Dough",
    body: [
      "Pizza dough uses flour, water, yeast and salt. Long cold fermentation improves flavour. Bake in a very hot oven.",
    ],
    tags: ["cooking"],
  },
  {
    title: "Real-time Collaboration",
    body: [
      "CRDTs like Yjs let many people edit one document at the same time and merge without conflicts, even offline.",
    ],
    links: ["CRDTs"],
    tags: ["engineering"],
  },
  {
    title: "CRDTs",
    body: [
      "Conflict-free replicated data types converge to the same state on every replica. Yjs implements a CRDT for collaborative text editing.",
    ],
    tags: ["engineering"],
  },
  {
    title: "WebSockets",
    body: [
      "WebSockets keep a persistent connection so the server can push updates. Collaborative editors sync CRDT updates over websockets.",
    ],
    links: ["Real-time Collaboration"],
    tags: ["engineering"],
  },
  {
    title: "Postgres Indexing",
    body: [
      "Database indexes speed up queries. A btree index on foreign keys avoids sequential scans in Postgres.",
    ],
    tags: ["engineering"],
  },
  {
    title: "Meeting Notes 2026-09",
    body: [
      "Discussed shipping the graph view and ghost links. Action: write docs, review the CRDT sync performance.",
    ],
    links: ["Knowledge Graphs", "CRDTs"],
    tags: ["meetings"],
  },
];

function toState(n: Note): Uint8Array {
  const doc = new Y.Doc();
  const frag = doc.getXmlFragment("content");
  const h = new Y.XmlElement("heading");
  h.setAttribute("level", 1 as never);
  const ht = new Y.XmlText();
  ht.insert(0, n.title);
  h.insert(0, [ht]);
  frag.push([h]);
  for (const p of n.body) {
    const el = new Y.XmlElement("paragraph");
    const t = new Y.XmlText();
    t.insert(0, p);
    el.insert(0, [t]);
    frag.push([el]);
  }
  if (n.links?.length) {
    const el = new Y.XmlElement("paragraph");
    const kids: (Y.XmlElement | Y.XmlText)[] = [];
    const lead = new Y.XmlText();
    lead.insert(0, "See also: ");
    kids.push(lead);
    for (const l of n.links) {
      const w = new Y.XmlElement("wikiLink");
      w.setAttribute("title", l);
      kids.push(w);
      const sp = new Y.XmlText();
      sp.insert(0, " ");
      kids.push(sp);
    }
    el.insert(0, kids);
    frag.push([el]);
  }
  return Y.encodeStateAsUpdate(doc);
}

async function main() {
  const email = process.argv[2] ?? "demo@knowdex.dev";
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new Error(`No user ${email}; register first.`);
  let member = await prisma.workspaceMember.findFirst({
    where: { userId: user.id },
    orderBy: { joinedAt: "asc" },
  });
  if (!member) {
    const ws = await prisma.workspace.create({
      data: {
        name: "Demo",
        slug: `demo-${Date.now().toString(36)}`,
        ownerId: user.id,
        members: { create: { userId: user.id, role: "owner" } },
      },
    });
    member = await prisma.workspaceMember.findFirstOrThrow({
      where: { workspaceId: ws.id, userId: user.id },
    });
  }
  const wid = member.workspaceId;
  const ids = new Map<string, string>();
  let day = 0;
  for (const n of notes) {
    const existing = await prisma.content.findFirst({
      where: { workspaceId: wid, title: n.title, type: "document" },
    });
    const created = new Date(
      Date.now() - (notes.length - day++) * 3 * 86400_000,
    );
    const tagRows = (n.tags ?? []).map((name) => ({
      where: { name },
      create: { name },
    }));
    const c =
      existing ??
      (await prisma.content.create({
        data: {
          title: n.title,
          link: "https://internal.doc",
          type: "document",
          userId: user.id,
          workspaceId: wid,
          createdAt: created,
          tags: { connectOrCreate: tagRows },
        },
      }));
    ids.set(n.title, c.id);
    await prisma.document.upsert({
      where: { id: c.id },
      create: { id: c.id, state: toState(n) },
      update: { state: toState(n) },
    });
  }
  for (const n of notes) {
    for (const l of n.links ?? []) {
      const to = ids.get(l);
      if (to)
        await prisma.documentLink.upsert({
          where: {
            fromDocId_toDocId: { fromDocId: ids.get(n.title)!, toDocId: to },
          },
          create: { fromDocId: ids.get(n.title)!, toDocId: to },
          update: {},
        });
    }
  }
  console.log(`Seeded ${notes.length} notes into workspace ${wid}`);
}

main().finally(() => prisma.$disconnect());
