// OpenAPI 3.x JSON into request templates (slice 10, openapi-import). Only what a template needs is read: each
// operation's method, path, first tag, name, query and header parameters, and a JSON request-body example. The UI
// uses it for the import preview and the server for the import, so both always agree. `$ref`s and YAML are not
// resolved (change.md, out of scope).
import type { BodyInput } from './wire';

export class SpecError extends Error {}

export interface SpecOperation {
  method: string;
  path: string;
  tag: string | undefined;
  name: string;
  queryRows: [string, string][];
  headerRows: [string, string][];
  body: BodyInput;
}

export interface ParsedSpec {
  openapi: string;
  title: string;
  version: string;
  servers: string[];
  operations: SpecOperation[];
}

// TRACE is left out: the request form does not offer it (code review of openapi-import, 1).
const METHODS = [
  'get',
  'put',
  'post',
  'delete',
  'options',
  'head',
  'patch',
] as const;

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown) => (typeof value === 'string' ? value : '');

export function parseOpenApi(source: string): ParsedSpec {
  let doc: unknown;
  try {
    doc = JSON.parse(source);
  } catch (error) {
    throw new SpecError(jsonErrorText(source, (error as Error).message));
  }
  if (!isObject(doc) || !text(doc.openapi).startsWith('3.')) {
    throw new SpecError(
      'The file is not an OpenAPI 3 document: it needs "openapi": "3.x"',
    );
  }
  if (!isObject(doc.paths)) {
    throw new SpecError('The document has no "paths" object');
  }
  const info = isObject(doc.info) ? doc.info : {};
  const servers = Array.isArray(doc.servers)
    ? doc.servers.flatMap((s) =>
        isObject(s) && text(s.url) ? [text(s.url)] : [],
      )
    : [];

  const operations: SpecOperation[] = [];
  for (const [path, item] of Object.entries(doc.paths)) {
    // Where an invalid document failed, by its path (slice 11).
    if (!isObject(item)) {
      throw new SpecError(`paths[${JSON.stringify(path)}] is not an object`);
    }
    const shared = parametersOf(item.parameters);
    for (const method of METHODS) {
      const op = item[method];
      if (op === undefined) continue;
      if (!isObject(op)) {
        throw new SpecError(
          `paths[${JSON.stringify(path)}].${method} is not an object`,
        );
      }
      const params = mergeParameters(shared, parametersOf(op.parameters));
      const upper = method.toUpperCase();
      operations.push({
        method: upper,
        path,
        tag: Array.isArray(op.tags) ? text(op.tags[0]) || undefined : undefined,
        name: text(op.summary) || text(op.operationId) || `${upper} ${path}`,
        queryRows: rowsIn(params, 'query'),
        headerRows: rowsIn(params, 'header'),
        body: bodyOf(op.requestBody),
      });
    }
  }
  return {
    openapi: text(doc.openapi),
    title: text(info.title) || 'Untitled API',
    version: text(info.version),
    servers,
    operations,
  };
}

// "line L, column C" from the parser's character position, when it gives one (slice 11).
function jsonErrorText(source: string, message: string): string {
  const position = /position (\d+)/.exec(message)?.[1];
  if (position === undefined) return `The file is not valid JSON: ${message}`;
  const before = source.slice(0, Number(position));
  const line = before.split('\n').length;
  const column = Number(position) - before.lastIndexOf('\n');
  const reason = message.replace(/ in JSON at position \d+.*$/, '');
  return `The file is not valid JSON at line ${line}, column ${column}: ${reason}`;
}

interface Parameter {
  name: string;
  in: string;
  example: string;
}

function parametersOf(value: unknown): Parameter[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((p) =>
    isObject(p) && text(p.name) && text(p.in)
      ? [
          {
            name: text(p.name),
            in: text(p.in),
            example: exampleText(p.example),
          },
        ]
      : [],
  );
}

// Objects and arrays as JSON, not "[object Object]" (code review of openapi-import, 5).
function exampleText(example: unknown): string {
  if (example === undefined || example === null) return '';
  return typeof example === 'object'
    ? JSON.stringify(example)
    : String(example);
}

// Operation-level parameters override path-level ones with the same name and location (OpenAPI 3, Path Item).
function mergeParameters(shared: Parameter[], own: Parameter[]): Parameter[] {
  const key = (p: Parameter) => `${p.in}:${p.name}`;
  const merged = new Map(shared.map((p) => [key(p), p]));
  for (const p of own) merged.set(key(p), p);
  return [...merged.values()];
}

const rowsIn = (params: Parameter[], where: string): [string, string][] =>
  params.filter((p) => p.in === where).map((p) => [p.name, p.example]);

function bodyOf(requestBody: unknown): BodyInput {
  if (!isObject(requestBody) || !isObject(requestBody.content)) {
    return { type: 'none' };
  }
  const json = Object.entries(requestBody.content).find(([type]) =>
    /json/i.test(type),
  )?.[1];
  if (!isObject(json)) return { type: 'none' };
  let example: unknown = json.example;
  if (example === undefined && isObject(json.examples)) {
    const first = Object.values(json.examples)[0];
    example = isObject(first) ? first.value : undefined;
  }
  return example === undefined
    ? { type: 'json', text: '' }
    : { type: 'json', text: JSON.stringify(example, null, 2) };
}

/** Directories for the operations, in the order they first appear. */
export function groupOperations(
  operations: SpecOperation[],
  by: 'tag' | 'path',
): Map<string, SpecOperation[]> {
  const groups = new Map<string, SpecOperation[]>();
  for (const op of operations) {
    const name =
      by === 'tag'
        ? (op.tag ?? 'default')
        : (op.path.split('/').find((segment) => segment !== '') ?? 'root');
    const group = groups.get(name);
    if (group) group.push(op);
    else groups.set(name, [op]);
  }
  return groups;
}
