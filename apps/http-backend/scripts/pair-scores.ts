import "../src/env.js";
import { prisma } from "@repo/db";
import { docVectors } from "../src/semantic/search.js";
import { cosine } from "../src/semantic/vector.js";
async function main() {
  const ws = await prisma.workspaceMember.findFirstOrThrow({
    where: { user: { email: process.argv[2] ?? "demo@knowdex.dev" } },
  });
  const vs = (await docVectors(ws.workspaceId)).filter(() => true);
  const t = new Map(
    (
      await prisma.content.findMany({ where: { workspaceId: ws.workspaceId } })
    ).map((c) => [c.id, c.title]),
  );
  const rows: [number, string][] = [];
  for (let i = 0; i < vs.length; i++)
    for (let j = i + 1; j < vs.length; j++)
      rows.push([
        cosine(vs[i]!.vector, vs[j]!.vector),
        `${t.get(vs[i]!.docId)} <> ${t.get(vs[j]!.docId)}`,
      ]);
  rows.sort((a, b) => b[0] - a[0]);
  for (const [s, n] of rows
    .filter(([, n]) => !/ note \d+/.test(n))
    .slice(0, 20))
    console.log(s.toFixed(3), n);
  await prisma.$disconnect();
}
main();
