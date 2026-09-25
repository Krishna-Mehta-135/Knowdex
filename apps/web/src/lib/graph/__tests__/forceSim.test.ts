import { describe, expect, it } from "vitest";
import { ForceSim, distToSegment } from "../forceSim";

const ring = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `n${i}`, r: 5 }));

describe("ForceSim", () => {
  it("settles, stays finite, and stops being active", () => {
    const sim = new ForceSim();
    const nodes = ring(60);
    sim.setData(
      nodes,
      nodes.slice(1).map((n, i) => ({ a: `n${i}`, b: n.id })),
    );
    const ticks = sim.settle(1000);
    expect(ticks).toBeLessThan(1000);
    expect(sim.active).toBe(false);
    for (const n of sim.nodes) {
      expect(Number.isFinite(n.x)).toBe(true);
      expect(Number.isFinite(n.y)).toBe(true);
    }
  });

  it("lays out clusters: linked nodes are closer on average than unlinked", () => {
    const sim = new ForceSim();
    const nodes = ring(24);
    const links: { a: string; b: string }[] = [];
    for (const base of [0, 12]) {
      for (let i = 0; i < 12; i++) {
        links.push({ a: `n${base + i}`, b: `n${base + ((i + 1) % 12)}` });
        links.push({ a: `n${base + i}`, b: `n${base + ((i + 5) % 12)}` });
      }
    }
    sim.setData(nodes, links);
    sim.settle();
    const dist = (a: string, b: string) =>
      Math.hypot(
        sim.node(a)!.x - sim.node(b)!.x,
        sim.node(a)!.y - sim.node(b)!.y,
      );
    const linked = new Set(links.map((l) => `${l.a}|${l.b}`));
    let ls = 0,
      lc = 0,
      us = 0,
      uc = 0;
    for (let i = 0; i < 24; i++)
      for (let j = i + 1; j < 24; j++) {
        const d = dist(`n${i}`, `n${j}`);
        if (linked.has(`n${i}|n${j}`) || linked.has(`n${j}|n${i}`)) {
          ls += d;
          lc++;
        } else {
          us += d;
          uc++;
        }
      }
    expect(ls / lc).toBeLessThan((us / uc) * 0.8);
  });

  it("does not let nodes overlap", () => {
    const sim = new ForceSim();
    sim.setData(ring(30), []);
    sim.settle();
    for (const a of sim.nodes)
      for (const b of sim.nodes)
        if (a !== b)
          expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(6);
  });

  it("ignores duplicate, self and dangling links", () => {
    const sim = new ForceSim();
    sim.setData(ring(3), [
      { a: "n0", b: "n1" },
      { a: "n1", b: "n0" },
      { a: "n0", b: "n0" },
      { a: "n0", b: "ghost-id" },
    ]);
    expect(sim.links).toHaveLength(1);
  });

  it("preserves positions of existing nodes when data changes", () => {
    const sim = new ForceSim();
    sim.setData(ring(5), [{ a: "n0", b: "n1" }]);
    sim.settle();
    const before = { x: sim.node("n2")!.x, y: sim.node("n2")!.y };
    sim.setData([...ring(5), { id: "new", r: 5 }], [{ a: "n0", b: "new" }]);
    expect(sim.node("n2")).toMatchObject(before);
    expect(sim.active).toBe(true);
    // new node spawns near its neighbour
    const nb = sim.node("n0")!,
      nw = sim.node("new")!;
    expect(Math.hypot(nb.x - nw.x, nb.y - nw.y)).toBeLessThan(40);
  });

  it("pinned nodes stay put and reheat wakes a cooled sim", () => {
    const sim = new ForceSim();
    sim.setData(ring(5), [{ a: "n0", b: "n1" }]);
    sim.settle();
    expect(sim.active).toBe(false);
    const n = sim.node("n0")!;
    n.fx = 100;
    n.fy = 100;
    sim.reheat(0.5);
    sim.tick();
    expect([n.x, n.y]).toEqual([100, 100]);
  });

  it("handles empty and single-node graphs", () => {
    const sim = new ForceSim();
    sim.setData([], []);
    expect(sim.settle()).toBeGreaterThanOrEqual(0);
    sim.setData([{ id: "a", r: 4 }], []);
    sim.settle();
    expect(sim.bounds().maxX).toBeGreaterThan(sim.bounds().minX);
  });
});

describe("distToSegment", () => {
  it("measures perpendicular and endpoint distance", () => {
    expect(distToSegment(5, 3, 0, 0, 10, 0)).toBeCloseTo(3);
    expect(distToSegment(-4, 3, 0, 0, 10, 0)).toBeCloseTo(5);
    expect(distToSegment(1, 1, 2, 2, 2, 2)).toBeCloseTo(Math.SQRT2);
  });
});
