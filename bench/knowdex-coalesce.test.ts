import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  aggregateReceiverMetric,
  createCpuPeakSampler,
  operationContent,
  receiverEntriesInNumericOrder,
  workloadSchedule,
  WORKLOADS,
} from "./knowdex-coalesce.ts";

describe("Knowdex coalesce workload semantics", () => {
  it("uses exactly one character per typist operation while keeping unique detection", () => {
    for (const workload of ["one_typist", "five_typists"] as const) {
      const contents = Array.from(
        { length: WORKLOADS[workload].operations },
        (_, index) => operationContent(workload, index),
      );
      assert.equal(
        contents.every((content) => [...content].length === 1),
        true,
        workload,
      );
      assert.equal(new Set(contents).size, contents.length, workload);
    }
  });

  it("schedules one typist at 10 chars/s and five independent typists at 10 chars/s each", () => {
    const one = workloadSchedule("one_typist");
    assert.equal(one.length, 20);
    assert.equal(
      one.every((tick) => tick.operations.length === 1),
      true,
    );
    assert.equal(
      one.slice(1).every((tick) => tick.delayBeforeMs === 100),
      true,
    );

    const five = workloadSchedule("five_typists");
    assert.equal(five.length, 20);
    assert.equal(
      five.every((tick) => tick.operations.length === 5),
      true,
    );
    assert.deepEqual(
      five[0]?.operations.map((operation) => operation.senderIndex),
      [0, 1, 2, 3, 4],
    );
    assert.equal(
      five.slice(1).every((tick) => tick.delayBeforeMs === 100),
      true,
    );
  });

  it("keeps paste and AI operation counts distinct", () => {
    assert.equal(operationContent("paste_burst", 0).length, 2_000);
    assert.equal(workloadSchedule("paste_burst").length, 1);
    assert.equal(workloadSchedule("ai_stream").length, 50);
    assert.equal(
      workloadSchedule("ai_stream").every(
        (tick) => tick.operations.length === 1,
      ),
      true,
    );
  });
});

describe("receiver aggregation", () => {
  it("uses the median across all ten numeric receiver IDs", () => {
    const values = [10, 90, 30, 70, 50, 20, 80, 40, 60, 100];
    assert.equal(aggregateReceiverMetric(values), 55);
    assert.deepEqual(
      receiverEntriesInNumericOrder({
        "receiver-10": { frames: 10, bytes: 100 },
        "receiver-2": { frames: 2, bytes: 20 },
        "receiver-1": { frames: 1, bytes: 10 },
      }).map(([role]) => role),
      ["receiver-1", "receiver-2", "receiver-10"],
    );
  });
});

describe("generator CPU measurement boundaries", () => {
  it("captures a final short-duration sample when stopped before the interval fires", () => {
    const cpuSamples = [
      { user: 0, system: 0 },
      { user: 30_000, system: 0 },
      { user: 30_000, system: 0 },
    ];
    const wallSamples = [0, 50_000];
    const sampler = createCpuPeakSampler(
      () => cpuSamples.shift() ?? { user: 30_000, system: 0 },
      () => wallSamples.shift() ?? 50_000,
    );

    assert.equal(sampler.stop(), 60);
    assert.equal(sampler.stop(), 60);
  });

  it("starts after client setup and counter reset, and stops before aggregation", () => {
    const source = readFileSync(
      new URL("./knowdex-coalesce.ts", import.meta.url),
      "utf8",
    );
    const receiverSetupIndex = source.indexOf("receivers.push(");
    const senderSetupIndex = source.indexOf("senders.push(");
    const resetIndex = source.indexOf("await resetCounters();");
    const samplerStartIndex = source.indexOf(
      "const cpuSampler = createCpuPeakSampler();",
    );
    const samplerStopIndex = source.indexOf("stopCpuSampler();");
    const countersReadIndex = source.indexOf(
      "const counters = await readCounters();",
    );
    assert.ok(receiverSetupIndex >= 0);
    assert.ok(senderSetupIndex >= 0);
    assert.ok(resetIndex >= 0);
    assert.ok(resetIndex > receiverSetupIndex);
    assert.ok(resetIndex > senderSetupIndex);
    assert.ok(samplerStartIndex > resetIndex);
    assert.ok(samplerStopIndex > samplerStartIndex);
    assert.ok(countersReadIndex > samplerStopIndex);
  });
});
