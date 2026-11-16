import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import process from "node:process";

import { measureElapsedAndCpu, writeSchemaV1Result } from "./harness.ts";
import { requiredProvenance } from "./provenance.ts";

const seed = readFileSync(new URL("./seed.sql", import.meta.url), "utf8");
const measurement = measureElapsedAndCpu(() => {
  const digest = createHash("sha256").update(seed).digest("hex");
  const seededRows = [...seed.matchAll(/\(\s*\d+\s*,/g)].length;
  return { digest, seededRows };
});

const imageDigest = requiredProvenance(
  "BENCH_IMAGE_DIGEST",
  process.env.BENCH_IMAGE_DIGEST,
);
const commit = requiredProvenance("BENCH_COMMIT", process.env.BENCH_COMMIT);
const hostCpu = requiredProvenance("HOST_CPU", process.env.HOST_CPU);
const dockerVersion = requiredProvenance(
  "DOCKER_VERSION",
  process.env.DOCKER_VERSION,
);
const hostOs = requiredProvenance("HOST_OS", process.env.HOST_OS);
if (!imageDigest || !/^sha256:[a-f0-9]{64}$/.test(imageDigest)) {
  throw new Error(
    "self-check failed: BENCH_IMAGE_DIGEST must be a full lowercase image ID digest",
  );
}
const durationSeconds = measurement.durationSeconds;
const cpuPercent = Math.min(
  100,
  measurement.cpuMicros / (durationSeconds * 10_000),
);

await writeSchemaV1Result(process.argv[2] ?? "bench/results/trivial.json", {
  schema_version: "1",
  claim_id: "knowdex-trivial",
  project: "knowdex",
  variant: "candidate",
  workload: "trivial_seeded_local",
  repetition: 1,
  started_at: new Date(Date.now() - durationSeconds * 1000).toISOString(),
  duration_seconds: durationSeconds,
  metrics: [
    { name: "seeded_rows", unit: "rows", value: measurement.value.seededRows },
    {
      name: "seed_sha256_prefix",
      unit: "hex_characters",
      value: Number.parseInt(measurement.value.digest.slice(0, 8), 16),
    },
  ],
  environment: {
    commit,
    images: { http_backend: imageDigest },
    host_cpu: hostCpu,
    sut_cpuset: "0-1",
    sut_memory_mb: 384,
    generator_cpu_peak_percent: cpuPercent,
    docker: dockerVersion,
    os: hostOs,
  },
  limitations: [
    "Deterministic local seed calculation; it does not measure WebSocket frames or production traffic.",
  ],
});
