import { readFile } from 'node:fs/promises';

const [, , resultPath] = process.argv;
const schemaPath = process.argv[3] ?? new URL('./result-schema.schema.json', import.meta.url);
if (!resultPath) throw new Error('usage: node bench/validate-schema.mjs RESULT.json [SCHEMA.json]');

const [resultText, schemaText] = await Promise.all([readFile(resultPath, 'utf8'), readFile(schemaPath, 'utf8')]);
const result = JSON.parse(resultText);
const schema = JSON.parse(schemaText);
const errors = [];
validate(result, schema, schema, '$', errors);
if (errors.length > 0) {
  throw new Error(`result does not validate against ${schemaPath}:\n${errors.join('\n')}`);
}
console.log(`validated ${resultPath} against ${schemaPath}`);

function validate(value, current, root, path, errors) {
  if (current.$ref) {
    const target = current.$ref.startsWith('#/')
      ? current.$ref.slice(2).split('/').reduce((node, key) => node[key.replaceAll('~1', '/').replaceAll('~0', '~')], root)
      : undefined;
    if (!target) return errors.push(`${path}: unsupported reference ${current.$ref}`);
    return validate(value, target, root, path, errors);
  }
  if (current.const !== undefined && !Object.is(value, current.const)) errors.push(`${path}: must equal ${JSON.stringify(current.const)}`);
  if (current.type && !matchesType(value, current.type)) errors.push(`${path}: must be ${current.type}`);
  if (typeof value === 'string') {
    if (current.minLength !== undefined && [...value].length < current.minLength) errors.push(`${path}: string is too short`);
    if (current.pattern && !new RegExp(current.pattern).test(value)) errors.push(`${path}: does not match ${current.pattern}`);
    if (current.format === 'date-time' && !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value)) errors.push(`${path}: must be date-time`);
  }
  if (typeof value === 'number') {
    if (current.minimum !== undefined && value < current.minimum) errors.push(`${path}: below minimum`);
    if (current.maximum !== undefined && value > current.maximum) errors.push(`${path}: above maximum`);
  }
  if (Array.isArray(value)) {
    if (current.minItems !== undefined && value.length < current.minItems) errors.push(`${path}: too few items`);
    if (current.items) value.forEach((item, index) => validate(item, current.items.$ref ? resolveRef(current.items.$ref, root) : current.items, root, `${path}[${index}]`, errors));
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const properties = current.properties ?? {};
    if (current.required) for (const key of current.required) if (!(key in value)) errors.push(`${path}: missing required property ${key}`);
    if (current.minProperties !== undefined && Object.keys(value).length < current.minProperties) errors.push(`${path}: too few properties`);
    if (current.additionalProperties === false) for (const key of Object.keys(value)) if (!(key in properties)) errors.push(`${path}: unknown property ${key}`);
    for (const [key, child] of Object.entries(properties)) if (key in value) validate(value[key], child.$ref ? resolveRef(child.$ref, root) : child, root, `${path}.${key}`, errors);
    if (current.additionalProperties && typeof current.additionalProperties === 'object') for (const [key, childValue] of Object.entries(value)) if (!(key in properties)) validate(childValue, current.additionalProperties, root, `${path}.${key}`, errors);
  }
}

function resolveRef(ref, root) {
  if (!ref.startsWith('#/')) throw new Error(`unsupported reference ${ref}`);
  return ref.slice(2).split('/').reduce((node, key) => node[key.replaceAll('~1', '/').replaceAll('~0', '~')], root);
}

function matchesType(value, type) {
  return ({
    object: value !== null && typeof value === 'object' && !Array.isArray(value),
    array: Array.isArray(value),
    string: typeof value === 'string',
    number: typeof value === 'number' && Number.isFinite(value),
    integer: typeof value === 'number' && Number.isInteger(value),
    boolean: typeof value === 'boolean',
    null: value === null,
  })[type] === true;
}
