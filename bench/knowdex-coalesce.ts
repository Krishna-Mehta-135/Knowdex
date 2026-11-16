import { createHmac } from "node:crypto";
import process from "node:process";
import * as Y from "yjs";
import WebSocket from "ws";

import { ProtocolCodec } from "@repo/crdt";
import { writeSchemaV1Result, type SchemaV1Result } from "./harness.ts";

export const WORKLOADS = {
  one_typist: {
    operations: 20,
    batchSize: 1,
    intervalMs: 100,
    description: "one typist at 10 chars/s for 2s",
  },
  five_typists: {
    operations: 100,
    batchSize: 5,
    intervalMs: 100,
    description: "five typists at 10 chars/s each for 2s",
  },
  paste_burst: {
    operations: 1,
    batchSize: 1,
    intervalMs: 0,
    description: "one 2,000-character paste",
  },
  ai_stream: {
    operations: 50,
    batchSize: 1,
    intervalMs: 20,
    description: "50 tokens/s for 1s",
  },
} as const;

export type WorkloadName = keyof typeof WORKLOADS;

export type WorkloadOperation = { senderIndex: number; operationIndex: number };
export type WorkloadTick = {
  delayBeforeMs: number;
  operations: WorkloadOperation[];
};
export type ReceiverStats = { frames: number; bytes: number };

export function operationContent(
  workload: WorkloadName,
  operationIndex: number,
): string {
  if (workload === "paste_burst") return "x".repeat(2_000);
  if (workload === "one_typist" || workload === "five_typists") {
    return String.fromCharCode(0xe000 + operationIndex);
  }
  return `token-${operationIndex}`;
}

export function workloadSchedule(workload: WorkloadName): WorkloadTick[] {
  const config = WORKLOADS[workload];
  const senderCount = workload === "five_typists" ? SENDER_COUNT : 1;
  const ticks: WorkloadTick[] = [];
  const tickCount = Math.ceil(config.operations / config.batchSize);
  for (let tickIndex = 0; tickIndex < tickCount; tickIndex += 1) {
    const operations: WorkloadOperation[] = [];
    const firstOperation = tickIndex * config.batchSize;
    for (let senderIndex = 0; senderIndex < senderCount; senderIndex += 1) {
      const operationIndex = firstOperation + senderIndex;
      if (operationIndex >= config.operations) break;
      operations.push({ senderIndex, operationIndex });
    }
    ticks.push({
      delayBeforeMs: tickIndex === 0 ? 0 : config.intervalMs,
      operations,
    });
  }
  return ticks;
}

export function aggregateReceiverMetric(values: readonly number[]): number {
  if (values.length === 0)
    throw new Error("receiver aggregation requires at least one value");
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

export function receiverEntriesInNumericOrder(
  counters: Record<string, ReceiverStats>,
): [string, ReceiverStats][] {
  return Object.entries(counters).sort(([left], [right]) => {
    const leftId = Number(left.slice("receiver-".length));
    const rightId = Number(right.slice("receiver-".length));
    return leftId - rightId;
  });
}

const USER_ID = "00000000-0000-4000-8000-000000000001";
const DOCUMENT_ID = "00000000-0000-4000-8000-000000000002";
const JWT_SECRET = "projectbench-local-only";
const RECEIVER_COUNT = 10;
const SENDER_COUNT = 5;
const WS_URL = process.env.KNOWDEX_WS_URL ?? "ws://ws-backend-bench:8080";
const COUNTER_URL =
  process.env.KNOWDEX_COUNTER_URL ??
  "http://ws-backend-bench:8080/bench/counters";
const RESET_URL =
  process.env.KNOWDEX_RESET_URL ?? "http://ws-backend-bench:8080/bench/reset";
const CONFIG_URL =
  process.env.KNOWDEX_CONFIG_URL ?? "http://ws-backend-bench:8080/bench/config";

type Client = {
  socket: WebSocket;
  doc: Y.Doc;
  text: Y.Text;
  observedAt: Map<string, number>;
};

type RunResult = {
  framesPerReceiver: number[];
  bytesPerReceiver: number[];
  deliveryLatencyMs: number[];
  finalStates: string[];
  durationSeconds: number;
  generatorCpuPercent: number;
};

type CpuUsageSample = { user: number; system: number };

export type CpuPeakSampler = {
  stop: () => number;
};

export function createCpuPeakSampler(
  readCpuUsage: (
    previous?: CpuUsageSample,
  ) => CpuUsageSample = process.cpuUsage,
  readWallMicros: () => number = () => performance.now() * 1_000,
): CpuPeakSampler {
  let previousCpu = readCpuUsage();
  let previousWall = readWallMicros();
  let peakCpuPercent = 0;
  let stopped = false;

  const sample = (): void => {
    const currentCpu = readCpuUsage(previousCpu);
    const currentWall = readWallMicros();
    const wallMicros = currentWall - previousWall;
    if (wallMicros > 0)
      peakCpuPercent = Math.max(
        peakCpuPercent,
        ((currentCpu.user + currentCpu.system) / wallMicros) * 100,
      );
    previousCpu = readCpuUsage();
    previousWall = currentWall;
  };

  // CPU utilization is sampled over one-second windows; short bursts use the final partial window.
  const timer = setInterval(sample, 1_000);
  return {
    stop: () => {
      if (!stopped) {
        clearInterval(timer);
        sample();
        stopped = true;
      }
      return peakCpuPercent;
    },
  };
}

function base64Url(value: string): string {
  return Buffer.from(value).toString("base64url");
}

function localJwt(): string {
  const header = base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64Url(
    JSON.stringify({ id: USER_ID, iat: Math.floor(Date.now() / 1000) }),
  );
  const signingInput = `${header}.${payload}`;
  const signature = createHmac("sha256", JWT_SECRET)
    .update(signingInput)
    .digest("base64url");
  return `${signingInput}.${signature}`;
}

function connect(
  doc: Y.Doc,
  markers: readonly string[],
  isPaste: boolean,
  role: string,
): Promise<Client> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(
      `${WS_URL}/ws/documents/${DOCUMENT_ID}?token=${localJwt()}`,
      {
        headers: { "x-projectbench-role": role },
      },
    );
    const text = doc.getText("body");
    const client: Client = { socket, doc, text, observedAt: new Map() };
    socket.binaryType = "arraybuffer";
    const fail = (error: Error): void => reject(error);
    const failClose = (): void =>
      reject(new Error(`connection closed before handshake: ${role}`));
    socket.once("error", fail);
    socket.once("close", failClose);
    socket.once("open", () => {
      socket.send(
        ProtocolCodec.encode({
          type: "sync-step-1",
          stateVector: Y.encodeStateVector(doc),
        }),
      );
    });
    socket.on("message", (data) => {
      const message = ProtocolCodec.decode(new Uint8Array(data as ArrayBuffer));
      if (message.type === "sync-step-1") {
        socket.send(
          ProtocolCodec.encode({
            type: "sync-step-1",
            stateVector: Y.encodeStateVector(doc),
          }),
        );
      } else if (message.type === "sync-step-2" || message.type === "update") {
        Y.applyUpdate(doc, message.update);
        const now = performance.now();
        for (const marker of markers) {
          if (
            !client.observedAt.has(marker) &&
            text.toString().includes(marker)
          ) {
            client.observedAt.set(marker, now);
          }
        }
        if (
          isPaste &&
          !client.observedAt.has("paste") &&
          text.length >= 2_000
        ) {
          client.observedAt.set("paste", now);
        }
        if (message.type === "sync-step-2") {
          socket.off("error", fail);
          socket.off("close", failClose);
          resolve(client);
        }
      }
    });
  });
}

async function closeClient(client: Client): Promise<void> {
  if (client.socket.readyState === WebSocket.CLOSED) return;
  await new Promise<void>((resolve) => {
    client.socket.once("close", () => resolve());
    client.socket.close();
  });
}

async function resetCounters(): Promise<void> {
  const response = await fetch(COUNTER_URL, { method: "POST" });
  if (!response.ok) throw new Error(`counter reset failed: ${response.status}`);
}

async function resetDocument(): Promise<void> {
  const response = await fetch(RESET_URL, { method: "POST" });
  if (!response.ok)
    throw new Error(`document reset failed: ${response.status}`);
}

async function readCounters(): Promise<
  Record<string, { frames: number; bytes: number }>
> {
  const response = await fetch(COUNTER_URL);
  if (!response.ok) throw new Error(`counter read failed: ${response.status}`);
  return (await response.json()) as Record<
    string,
    { frames: number; bytes: number }
  >;
}

async function readConfig(): Promise<number> {
  const response = await fetch(CONFIG_URL);
  if (!response.ok)
    throw new Error(`bench config read failed: ${response.status}`);
  const body = (await response.json()) as { coalesce_interval_ms?: unknown };
  if (typeof body.coalesce_interval_ms !== "number")
    throw new Error("bench config omitted coalesce interval");
  return body.coalesce_interval_ms;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function runWorkload(workload: WorkloadName): Promise<RunResult> {
  const startedAt = performance.now();
  await resetDocument();
  const config = WORKLOADS[workload];
  const operationMarkers = Array.from(
    { length: config.operations },
    (_, index) =>
      workload === "paste_burst" ? "paste" : operationContent(workload, index),
  );
  const senderCount = workload === "five_typists" ? SENDER_COUNT : 1;
  const senders: Client[] = [];
  const receivers: Client[] = [];
  let peakCpuPercent = 0;
  let stopCpuSampler: (() => void) | undefined;

  try {
    for (let index = 0; index < RECEIVER_COUNT; index += 1) {
      receivers.push(
        await connect(
          new Y.Doc(),
          operationMarkers,
          workload === "paste_burst",
          `receiver-${index + 1}`,
        ),
      );
    }
    for (let index = 0; index < senderCount; index += 1) {
      senders.push(
        await connect(
          new Y.Doc(),
          operationMarkers,
          false,
          `sender-${index + 1}`,
        ),
      );
    }
    await resetCounters();

    const sentAt = new Map<string, number>();
    const senderStateVectors = senders.map((sender) =>
      Y.encodeStateVector(sender.doc),
    );
    const cpuSampler = createCpuPeakSampler();
    stopCpuSampler = () => {
      peakCpuPercent = cpuSampler.stop();
      stopCpuSampler = undefined;
    };
    for (const tick of workloadSchedule(workload)) {
      if (tick.delayBeforeMs > 0) await wait(tick.delayBeforeMs);
      for (const operation of tick.operations) {
        const { senderIndex, operationIndex } = operation;
        const marker = operationMarkers[operationIndex]!;
        const sender = senders[senderIndex]!;
        const content = operationContent(workload, operationIndex);
        Y.transact(sender.doc, () =>
          sender.text.insert(sender.text.length, content),
        );
        const update = Y.encodeStateAsUpdate(
          sender.doc,
          senderStateVectors[senderIndex]!,
        );
        senderStateVectors[senderIndex] = Y.encodeStateVector(sender.doc);
        sentAt.set(marker, performance.now());
        sender.socket.send(ProtocolCodec.encode({ type: "update", update }));
      }
    }

    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const allClients = [...senders, ...receivers];
      const firstState = allClients[0]?.text.toString();
      if (
        firstState !== undefined &&
        allClients.every((client) => client.text.toString() === firstState)
      )
        break;
      await wait(10);
    }

    const allClients = [...senders, ...receivers];
    const finalState = allClients[0]?.text.toString() ?? "";
    if (allClients.some((client) => client.text.toString() !== finalState)) {
      throw new Error(
        "self-check failed: all clients did not converge before timeout",
      );
    }
    stopCpuSampler();
    const counters = await readCounters();
    const receiverEntries = receiverEntriesInNumericOrder(counters);
    if (receiverEntries.length !== RECEIVER_COUNT)
      throw new Error(
        `self-check failed: expected ${RECEIVER_COUNT} receiver counters`,
      );
    const framesPerReceiver = receiverEntries.map(([, value]) => value.frames);
    const bytesPerReceiver = receiverEntries.map(([, value]) => value.bytes);
    const deliveryTimes: number[] = [];
    const measuredMarkers =
      workload === "paste_burst" ? ["paste"] : operationMarkers;
    for (const marker of measuredMarkers) {
      const sent = sentAt.get(marker);
      if (sent === undefined)
        throw new Error(`self-check failed: no send timestamp for ${marker}`);
      const observed = receivers.map((receiver) =>
        receiver.observedAt.get(marker),
      );
      if (observed.some((time) => time === undefined))
        throw new Error(
          `self-check failed: ${marker} was not visible on every receiver`,
        );
      deliveryTimes.push(
        Math.max(...observed.map((time) => time ?? sent)) - sent,
      );
    }
    return {
      framesPerReceiver,
      bytesPerReceiver,
      deliveryLatencyMs: deliveryTimes,
      finalStates: allClients.map((client) => client.text.toString()),
      durationSeconds: (performance.now() - startedAt) / 1_000,
      generatorCpuPercent: peakCpuPercent,
    };
  } finally {
    stopCpuSampler?.();
    await Promise.all([...senders, ...receivers].map(closeClient));
  }
}

export function selfCheck(
  result: RunResult,
  expectedOperations: number,
  expectedState?: string,
): void {
  if (
    result.framesPerReceiver.length !== RECEIVER_COUNT ||
    result.framesPerReceiver.some((count) => count !== expectedOperations)
  ) {
    throw new Error(
      `self-check failed: expected ${RECEIVER_COUNT} receivers with ${expectedOperations} update frames`,
    );
  }
  if (
    expectedState !== undefined &&
    result.finalStates.some((state) => state !== expectedState)
  ) {
    throw new Error(
      "self-check failed: receivers did not converge to the sender state",
    );
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`self-check failed: ${name} must be provided`);
  return value;
}

async function main(): Promise<void> {
  const workload = (process.argv[2] ?? "one_typist") as WorkloadName;
  if (!(workload in WORKLOADS))
    throw new Error(`unknown workload: ${workload}`);
  const variant = requiredEnv("KNOWDEX_VARIANT");
  const expectedInterval = Number(requiredEnv("KNOWDEX_COALESCE_INTERVAL_MS"));
  if (!Number.isSafeInteger(expectedInterval) || expectedInterval < 0) {
    throw new Error(
      "self-check failed: KNOWDEX_COALESCE_INTERVAL_MS must be a safe nonnegative integer",
    );
  }
  const actualInterval = await readConfig();
  if (actualInterval !== expectedInterval) {
    throw new Error(
      `self-check failed: backend interval ${actualInterval} does not match requested ${expectedInterval}`,
    );
  }
  const startedAt = new Date().toISOString();
  const result = await runWorkload(workload);
  const senderText =
    workload === "five_typists"
      ? undefined
      : Array.from({ length: WORKLOADS[workload].operations }, (_, index) =>
          operationContent(workload, index),
        ).join("");
  if (variant === "baseline") {
    selfCheck(result, WORKLOADS[workload].operations, senderText);
  }

  if (process.argv[3] === "--warmup") return;
  const output = process.argv[3] ?? `bench/results/knowdex-${workload}.json`;
  if (result.generatorCpuPercent > 70) {
    throw new Error(
      `self-check failed: generator CPU ${result.generatorCpuPercent.toFixed(2)}% exceeds 70%`,
    );
  }
  const sortedLatency = [...result.deliveryLatencyMs].sort((a, b) => a - b);
  const percentile = (fraction: number): number =>
    sortedLatency[
      Math.min(
        sortedLatency.length - 1,
        Math.ceil(sortedLatency.length * fraction) - 1,
      )
    ] ?? 0;
  const receiverMetrics = result.framesPerReceiver.flatMap((frames, index) => [
    {
      name: `outbound_frames_receiver_${index + 1}`,
      unit: "frames",
      value: frames,
    },
    {
      name: `outbound_bytes_receiver_${index + 1}`,
      unit: "bytes",
      value: result.bytesPerReceiver[index] ?? 0,
    },
  ]);
  const schemaResult: SchemaV1Result = {
    schema_version: "1",
    claim_id: "knowdex-coalesce-volume",
    project: "knowdex",
    variant,
    workload,
    repetition: Number(process.env.KNOWDEX_REPETITION ?? "1"),
    started_at: startedAt,
    duration_seconds: result.durationSeconds,
    metrics: [
      {
        name: "outbound_frames_per_receiver",
        unit: "frames",
        value: aggregateReceiverMetric(result.framesPerReceiver),
      },
      {
        name: "outbound_bytes_per_receiver",
        unit: "bytes",
        value: aggregateReceiverMetric(result.bytesPerReceiver),
      },
      ...receiverMetrics,
      { name: "delivery_latency_p50", unit: "ms", value: percentile(0.5) },
      { name: "delivery_latency_p99", unit: "ms", value: percentile(0.99) },
    ],
    environment: {
      commit: requiredEnv("BENCH_COMMIT"),
      images: { ws: requiredEnv("BENCH_IMAGE_DIGEST") },
      host_cpu: requiredEnv("HOST_CPU"),
      sut_cpuset: "0-1",
      sut_memory_mb: 384,
      generator_cpu_peak_percent: result.generatorCpuPercent,
      docker: requiredEnv("DOCKER_VERSION"),
      os: requiredEnv("HOST_OS"),
    },
    limitations: [
      "Final measurements require the 12 GB Docker memory checkpoint.",
      "The experiment is local Docker only and excludes sync, awareness, and control frames from the update counters.",
      "Generator CPU peak uses 1-second sampling windows; workloads shorter than 1 second use their full measured duration.",
      "Typist latency markers use unique synthetic private-use Unicode characters; their encoded bytes may differ from ASCII typing.",
    ],
  };
  await writeSchemaV1Result(output, schemaResult);
}

if (process.argv[1]?.endsWith("knowdex-coalesce.ts")) void main();
