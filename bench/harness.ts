import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import process from 'node:process';

export type InterleavedSample<T> = { variant: string; index: number; value: T };

export type CpuSample<T> = {
  value: T;
  cpuUserMicros: number;
  cpuSystemMicros: number;
  wallMicros: number;
};

export type ElapsedCpuSample<T> = {
  value: T;
  durationSeconds: number;
  cpuMicros: number;
};

export type SchemaV1Metric = { name: string; unit: string; value: number };

export type SchemaV1Environment = {
  commit: string;
  images: Record<string, string>;
  host_cpu: string;
  sut_cpuset: string;
  sut_memory_mb: number;
  generator_cpu_peak_percent: number;
  docker: string;
  os: string;
};

export type SchemaV1Result = {
  schema_version: '1';
  claim_id: string;
  project: string;
  variant: string;
  workload: string;
  repetition: number;
  started_at: string;
  duration_seconds: number;
  metrics: readonly SchemaV1Metric[];
  environment: SchemaV1Environment;
  limitations: readonly string[];
};

export async function repetitions<T>(count: number, generator: () => T | Promise<T>): Promise<T[]> {
  assertNonNegativeInteger(count, 'count');
  const values: T[] = [];
  for (let index = 0; index < count; index += 1) values.push(await generator());
  return values;
}

export function median(values: readonly number[]): number {
  if (values.length === 0) throw new Error('median requires at least one value');
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

export function range(values: readonly number[]): { min: number; max: number; width: number } {
  if (values.length === 0) throw new Error('range requires at least one value');
  const min = Math.min(...values);
  const max = Math.max(...values);
  return { min, max, width: max - min };
}

export function interleave<T>(variants: Readonly<Record<string, readonly T[]>>): InterleavedSample<T>[] {
  const entries = Object.entries(variants);
  if (entries.length === 0) return [];
  const repetitionCount = entries[0]![1].length;
  for (const [variant, values] of entries) {
    if (values.length !== repetitionCount) throw new Error(`variant ${variant} has ${values.length} samples; expected ${repetitionCount}`);
  }
  return Array.from({ length: repetitionCount }, (_, index) =>
    entries.map(([variant, values]) => ({ variant, index, value: values[index]! })),
  ).flat();
}

export function discardWarmup<T>(samples: readonly T[], warmupCount: number): T[] {
  assertNonNegativeInteger(warmupCount, 'warmupCount');
  return samples.slice(warmupCount);
}

export function generatorCpuIsValid(peakPercent: number): boolean {
  return Number.isFinite(peakPercent) && peakPercent >= 0 && peakPercent <= 100;
}

export function measureGeneratorCpu<T>(generator: () => T): CpuSample<T> {
  const cpuBefore = process.cpuUsage();
  const wallBefore = process.hrtime.bigint();
  const value = generator();
  const cpu = process.cpuUsage(cpuBefore);
  return {
    value,
    cpuUserMicros: cpu.user,
    cpuSystemMicros: cpu.system,
    wallMicros: Number(process.hrtime.bigint() - wallBefore) / 1_000,
  };
}

export function measureElapsedAndCpu<T>(generator: () => T): ElapsedCpuSample<T> {
  const cpuBefore = process.cpuUsage();
  const wallBefore = process.hrtime.bigint();
  const value = generator();
  const cpu = process.cpuUsage(cpuBefore);
  return {
    value,
    durationSeconds: Number(process.hrtime.bigint() - wallBefore) / 1_000_000_000,
    cpuMicros: cpu.user + cpu.system,
  };
}

export async function writeSchemaV1Result(path: string, result: SchemaV1Result): Promise<void> {
  validateSchemaV1Result(result);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(result)}\n`, 'utf8');
}

function validateSchemaV1Result(result: SchemaV1Result): void {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new Error('result must be an object');
  }
  assertExactKeys(result, [
    'schema_version', 'claim_id', 'project', 'variant', 'workload', 'repetition',
    'started_at', 'duration_seconds', 'metrics', 'environment', 'limitations',
  ], 'result');
  if ('schemaVersion' in result || 'benchmark' in result || 'samples' in result) {
    throw new Error('legacy result fields are not allowed; expected schema_version');
  }
  for (const field of ['claim_id', 'project', 'variant', 'workload', 'started_at'] as const) {
    if (typeof result[field] !== 'string' || result[field].length === 0) throw new Error(`${field} must be a non-empty string`);
  }
  if (result.schema_version !== '1') throw new Error('schema_version must be "1"');
  if (!Number.isInteger(result.repetition) || result.repetition < 1) throw new Error('repetition must be a positive integer');
  if (!Number.isFinite(result.duration_seconds) || result.duration_seconds < 0) throw new Error('duration_seconds must be non-negative');
  if (!Array.isArray(result.metrics) || result.metrics.length === 0) throw new Error('metrics must be a non-empty array');
  for (const metric of result.metrics) {
    if (!metric || typeof metric !== 'object' || Array.isArray(metric)) throw new Error('metrics must contain objects');
    assertExactKeys(metric, ['name', 'unit', 'value'], 'metric');
    if (!metric || typeof metric.name !== 'string' || !metric.name || typeof metric.unit !== 'string' || !metric.unit || !Number.isFinite(metric.value)) throw new Error('metrics must contain name, unit, and numeric value');
  }
  const environment = result.environment;
  if (!environment || typeof environment !== 'object' || Array.isArray(environment)) throw new Error('environment must be an object');
  assertExactKeys(environment, [
    'commit', 'images', 'host_cpu', 'sut_cpuset', 'sut_memory_mb',
    'generator_cpu_peak_percent', 'docker', 'os',
  ], 'environment');
  for (const field of ['commit', 'host_cpu', 'sut_cpuset', 'docker', 'os'] as const) {
    if (typeof environment?.[field] !== 'string' || !environment[field]) throw new Error(`environment.${field} is required for provenance`);
  }
  if (!Number.isInteger(environment.sut_memory_mb) || environment.sut_memory_mb <= 0) throw new Error('environment.sut_memory_mb is required');
  if (!generatorCpuIsValid(environment.generator_cpu_peak_percent)) throw new Error('generator CPU peak must be between 0 and 100%');
  const images = environment.images;
  if (!images || typeof images !== 'object' || Array.isArray(images) || Object.keys(images).length === 0 || Object.values(images).some((digest) => typeof digest !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(digest))) throw new Error('environment.images must contain only full lowercase image digests');
  if (!Array.isArray(result.limitations) || result.limitations.some((item) => typeof item !== 'string')) throw new Error('limitations must be an array of strings');
}

function assertExactKeys(value: object, allowed: readonly string[], label: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) throw new Error(`${label} has unknown field(s): ${unknown.join(', ')}`);
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`);
}
