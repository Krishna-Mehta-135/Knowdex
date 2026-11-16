import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

const composeFile = new URL("../docker-compose.bench.yml", import.meta.url);
const makefile = readFileSync(new URL("../Makefile", import.meta.url), "utf8");
const hostCpuScript = readFileSync(
  new URL("./host-cpu.sh", import.meta.url),
  "utf8",
);
const generatorDockerfile = readFileSync(
  new URL("./generator/Dockerfile", import.meta.url),
  "utf8",
);
const seedSql = readFileSync(new URL("./seed.sql", import.meta.url), "utf8");

test("coalescing target supports rerunning a selected workload", () => {
  assert.match(
    makefile,
    /^BENCH_WORKLOADS \?= one_typist five_typists paste_burst ai_stream$/m,
  );
  assert.match(makefile, /for workload in \$\(BENCH_WORKLOADS\); do/);
});

test("benchmark seed is not a Postgres init script", () => {
  const config = JSON.parse(
    execFileSync(
      "docker",
      [
        "compose",
        "--profile",
        "seed",
        "-f",
        composeFile.pathname,
        "config",
        "--format",
        "json",
      ],
      {
        encoding: "utf8",
      },
    ),
  );
  const postgresVolumes = config.services["postgres-bench"].volumes ?? [];
  assert.equal(
    postgresVolumes.some(
      (volume) =>
        volume.target ===
        "/docker-entrypoint-initdb.d/001-projectbench-seed.sql",
    ),
    false,
  );
  assert.deepEqual(config.services["seed-bench"].profiles, ["seed"]);
  assert.equal(
    config.services["seed-bench"].volumes[0].target,
    "/seed/seed.sql",
  );
});

test("bench-up seeds only after the health-gated stack starts", () => {
  const up = makefile.indexOf("up -d --build --wait");
  const seed = makefile.indexOf("--profile seed run --rm --no-deps seed-bench");
  const validation = makefile.indexOf("SELECT count(*) FROM projectbench_seed");
  assert.ok(up >= 0);
  assert.ok(seed > up);
  assert.ok(validation > seed);
});

test("benchmark targets follow the acceptance names", () => {
  assert.match(
    makefile,
    /^\.PHONY: bench-up bench-down bench-trivial bench-knowdex-coalesce claim$/m,
  );
  assert.match(makefile, /^bench-trivial:\s*$/m);
  assert.match(makefile, /^claim: bench-trivial\s*$/m);
});

test("bench-trivial records the image digest from the running backend container", () => {
  assert.match(makefile, /BENCH_COMPOSE\) ps -q http-backend-bench/);
  assert.match(
    makefile,
    /docker inspect "\$\$container_id" --format='\{\{\.Image\}\}'/,
  );
  assert.doesNotMatch(makefile, /images -q http-backend-bench/);
  assert.doesNotMatch(makefile, /docker image inspect/);
  assert.doesNotMatch(makefile, /run --rm --no-deps --cpuset-cpus/);
  assert.doesNotMatch(
    makefile,
    /run --rm --no-deps generator-bench[^\n]*--cpus/,
  );
});

test("generator runtime supports TypeScript stripping", () => {
  const baseImage = generatorDockerfile.match(
    /^FROM node:(\d+)\.(\d+)\.(\d+)-alpine[^\n]*$/m,
  );
  assert.ok(baseImage, "generator image must pin an exact Alpine Node release");
  assert.ok(
    Number(baseImage[1]) >= 22,
    "generator runtime must support --experimental-strip-types",
  );
  assert.match(
    makefile,
    /generator-bench node --experimental-strip-types \/app\/bench\/trivial\.ts/,
  );
  assert.match(
    makefile,
    /node bench\/validate-schema\.mjs bench\/results\/trivial\.json bench\/result-schema\.schema\.json/,
  );
});

test("bench-trivial passes the measured environment into the generator container", () => {
  const normalizedMakefile = makefile
    .replace(/\\\n\s*/g, " ")
    .replace(/\s+/g, " ");
  const expectedCommand =
    '$(BENCH_COMPOSE) run --rm --no-deps -e BENCH_COMMIT="$$commit" -e HOST_CPU="$$host_cpu" -e DOCKER_VERSION="$$docker_version" -e HOST_OS="$$host_os" -e BENCH_IMAGE_DIGEST="$$digest" generator-bench node --experimental-strip-types /app/bench/trivial.ts /app/results/trivial.json';
  assert.ok(
    normalizedMakefile.includes(expectedCommand),
    `missing exact generator command: ${expectedCommand}`,
  );
});

test("generator service owns the bench-trivial CPU placement", () => {
  const config = JSON.parse(
    execFileSync(
      "docker",
      ["compose", "-f", composeFile.pathname, "config", "--format", "json"],
      { encoding: "utf8" },
    ),
  );
  assert.equal(config.services["generator-bench"].cpuset, "2-3");
  assert.equal(config.services["generator-bench"].cpus, 2);
});

test("bench-trivial records a model instead of uname architecture", () => {
  assert.doesNotMatch(makefile, /host_cpu=\$\$\(uname -p\)/);
  assert.match(makefile, /host_cpu=\$\$\(sh bench\/host-cpu\.sh\)/);
  assert.match(hostCpuScript, /Darwin\)/);
  assert.match(hostCpuScript, /Linux\)/);
  assert.match(hostCpuScript, /unable to determine host CPU model/);
});

test("W3 recreates only the WS backend and verifies the interval before a run", () => {
  assert.match(makefile, /--force-recreate --wait ws-backend-bench/);
  assert.match(makefile, /bench\/config/);
  assert.match(makefile, /KNOWDEX_COALESCE_INTERVAL_MS=\$\$interval/);
});

test("W3 generator uses explicit workspace dependencies and Compose DNS", () => {
  const benchPackage = JSON.parse(
    readFileSync(new URL("./package.json", import.meta.url), "utf8"),
  );
  assert.equal(benchPackage.dependencies["@repo/crdt"], "workspace:*");
  assert.equal(benchPackage.dependencies.ws, "^8.18.0");
  assert.equal(benchPackage.dependencies.yjs, "^13.6.30");
  assert.match(
    readFileSync(new URL("./knowdex-coalesce.ts", import.meta.url), "utf8"),
    /ws-backend-bench:8080/,
  );
  assert.match(
    generatorDockerfile,
    /cd \/app\/bench && node --input-type=module -e/,
  );
  assert.doesNotMatch(generatorDockerfile, /RUN node --input-type=module -e/);
  assert.match(
    generatorDockerfile,
    /await import\('ws'\).*await import\('yjs'\).*await import\('@repo\/crdt'\)/s,
  );
});

test("W3 seed supplies required Content timestamps", () => {
  assert.match(seedSql, /"createdAt", "updatedAt"/);
  assert.match(seedSql, /CURRENT_TIMESTAMP,\s*CURRENT_TIMESTAMP/);
});

test("W3 results fail closed on provenance and record canonical frame metric", () => {
  const harness = readFileSync(
    new URL("./knowdex-coalesce.ts", import.meta.url),
    "utf8",
  );
  assert.match(harness, /requiredEnv\("BENCH_COMMIT"\)/);
  assert.match(harness, /requiredEnv\("BENCH_IMAGE_DIGEST"\)/);
  assert.match(harness, /outbound_frames_per_receiver/);
  assert.match(harness, /outbound_bytes_per_receiver/);
  assert.match(
    harness,
    /const startedAt = new Date\(\)\.toISOString\(\);[\s\S]*const result = await runWorkload/,
  );
  assert.doesNotMatch(harness, /local-unset|repeat\(64\)/);
});

test("W3 focused suites are wired into CI package scripts under tsx", () => {
  const wsPackage = JSON.parse(
    readFileSync(
      new URL("../apps/ws-backend/package.json", import.meta.url),
      "utf8",
    ),
  );
  const benchPackage = JSON.parse(
    readFileSync(new URL("./package.json", import.meta.url), "utf8"),
  );
  assert.equal(wsPackage.scripts.test, "tsx --test src/*.test.ts");
  assert.equal(benchPackage.scripts.test, "tsx --test *.test.ts");
  assert.equal(benchPackage.scripts.typecheck, "tsc --noEmit -p tsconfig.json");
  assert.doesNotMatch(wsPackage.scripts.test, /experimental-strip-types/);
  assert.doesNotMatch(benchPackage.scripts.test, /experimental-strip-types/);
});

test("W3 memory gate uses the plan's decimal 12 GB boundary", () => {
  assert.match(makefile, /-ge 12000000000/);
  assert.doesNotMatch(makefile, /-ge 12884901888/);
  assert.match(makefile, /12 GB \(decimal, 12000000000 bytes\)/);
  assert.match(makefile, /12 GiB \(binary\) is 12884901888 bytes/);
  assert.equal(12480258048 >= 12000000000, true);
  assert.equal(11999999999 >= 12000000000, false);
});
