import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

import {
  discardWarmup,
  generatorCpuIsValid,
  interleave,
  median,
  range,
  repetitions,
  measureElapsedAndCpu,
  writeSchemaV1Result,
  type SchemaV1Result,
} from './harness.ts';

const result: SchemaV1Result = {
  schema_version: '1',
  claim_id: 'knowdex-trivial',
  project: 'knowdex',
  variant: 'candidate',
  workload: 'trivial_seeded_local',
  repetition: 1,
  started_at: '2026-11-15T00:00:00.000Z',
  duration_seconds: 0.01,
  metrics: [
    { name: 'frames_received', unit: 'frames', value: 3 },
    { name: 'latency', unit: 'ms', value: 2 },
  ],
  environment: {
    commit: 'abc123',
    images: { app: `sha256:${'0'.repeat(64)}` },
    host_cpu: 'Apple M2',
    sut_cpuset: '0-1',
    sut_memory_mb: 384,
    generator_cpu_peak_percent: 12,
    docker: 'Docker 28.0.0',
    os: 'Darwin 25.0.0',
  },
  limitations: ['Trivial workload; not representative of production traffic.'],
};

describe('benchmark harness helpers', () => {
  it('runs the requested number of repetitions', async () => {
    let calls = 0;
    assert.deepEqual(await repetitions(3, () => ++calls), [1, 2, 3]);
  });

  it('computes median and inclusive range from measured values', () => {
    assert.equal(median([9, 1, 4, 7, 3]), 4);
    assert.equal(median([1, 5, 9, 11]), 7);
    assert.deepEqual(range([9, 1, 4, 7, 3]), { min: 1, max: 9, width: 8 });
  });

  it('interleaves A/B repetitions in stable round-robin order', () => {
    assert.deepEqual(interleave({ baseline: [1, 2], candidate: ['a', 'b'] }), [
      { variant: 'baseline', index: 0, value: 1 },
      { variant: 'candidate', index: 0, value: 'a' },
      { variant: 'baseline', index: 1, value: 2 },
      { variant: 'candidate', index: 1, value: 'b' },
    ]);
  });

  it('discards only configured warm-up samples', () => {
    assert.deepEqual(discardWarmup([0, 1, 2, 3], 2), [2, 3]);
    assert.deepEqual(discardWarmup([0, 1], 2), []);
  });

  it('validates generator CPU percentages against the schema range', () => {
    assert.equal(generatorCpuIsValid(100), true);
    assert.equal(generatorCpuIsValid(100.01), false);
  });

  it('writes the exact snake_case schema-v1 result with provenance, digest, and limitations', async () => {
    const directory = await mkdtemp('/tmp/projectbench-harness-');
    const path = `${directory}/result.json`;
    await writeSchemaV1Result(path, result);

    const written = JSON.parse(await readFile(path, 'utf8'));
    assert.deepEqual(written, result);
    assert.equal(written.schema_version, '1');
    assert.ok(written.environment.images.app);
    assert.ok(written.environment.commit);
    assert.ok(written.limitations.length > 0);
    assert.equal('schemaVersion' in written, false);
    assert.equal('benchmark' in written, false);
    assert.equal('samples' in written, false);
  });

  it('allows an empty limitations array because the schema permits it', async () => {
    const directory = await mkdtemp('/tmp/projectbench-harness-');
    const path = `${directory}/result.json`;
    await writeSchemaV1Result(path, { ...result, limitations: [] });
    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')).limitations, []);
  });

  it('requires exactly 64 lowercase hexadecimal digest characters', async () => {
    const directory = await mkdtemp('/tmp/projectbench-harness-');
    const path = `${directory}/result.json`;
    await assert.rejects(
      writeSchemaV1Result(path, { ...result, environment: { ...result.environment, images: { app: 'sha256:01234567' } } }),
      /digest|image/,
    );
    await assert.rejects(
      writeSchemaV1Result(path, { ...result, environment: { ...result.environment, images: { app: `sha256:${'A'.repeat(64)}` } } }),
      /digest|image/,
    );
    await assert.rejects(
      writeSchemaV1Result(path, { ...result, environment: { ...result.environment, images: {} } }),
      /digest|image/,
    );
  });

  it('rejects unknown fields at every schema level', async () => {
    const directory = await mkdtemp('/tmp/projectbench-harness-');
    const path = `${directory}/result.json`;
    await assert.rejects(writeSchemaV1Result(path, { ...result, extra: true } as never), /unknown|additional|extra/);
    await assert.rejects(
      writeSchemaV1Result(path, { ...result, metrics: [{ ...result.metrics[0], extra: true }] }),
      /unknown|additional|extra/,
    );
    await assert.rejects(
      writeSchemaV1Result(path, { ...result, environment: { ...result.environment, extra: true } }),
      /unknown|additional|extra/,
    );
  });

  it('measures actual elapsed time and process CPU for a synchronous calculation', () => {
    const measurement = measureElapsedAndCpu(() => createHash('sha256').update('ProjectBench').digest('hex'));
    assert.match(measurement.value, /^[0-9a-f]{64}$/);
    assert.ok(measurement.durationSeconds > 0);
    assert.ok(measurement.cpuMicros > 0);
  });

  it('rejects missing provenance, digests, and legacy fields', async () => {
    const directory = await mkdtemp('/tmp/projectbench-harness-');
    const path = `${directory}/result.json`;
    await assert.rejects(
      writeSchemaV1Result(path, { schemaVersion: 1, benchmark: 'bad', samples: [] } as never),
      /schema_version|legacy|claim_id|unknown/,
    );
  });
});
