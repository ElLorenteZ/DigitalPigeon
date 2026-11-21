// Request templates imported from specs (slice 10, openapi-import). A source is one imported file; its templates are
// one per operation, filed into directories. Templates are form content (WireInput): opening one loads the form,
// unlinked, and nothing here touches History (roadmap M2 decision).
import { randomUUID } from 'node:crypto';
import type { Db } from 'mongodb';
import { groupOperations, parseOpenApi } from './openapi';
import type { WireInput } from './wire';

export interface TemplateSourceDoc {
  _id: string;
  name: string;
  kind: 'openapi';
  filename: string;
  grouping: 'tag' | 'path';
  importedAt: Date;
}

export interface TemplateDoc {
  _id: string;
  sourceId: string;
  /** Position within the source, so the tree keeps the spec's order. */
  order: number;
  directory: string;
  name: string;
  request: WireInput;
}

export interface TemplateListing {
  id: string;
  directory: string;
  name: string;
  method: string;
  path: string;
}

export interface TemplateSourceListing {
  id: string;
  name: string;
  kind: 'openapi';
  importedAt: Date;
  templates: TemplateListing[];
}

export interface ImportInput {
  text: string;
  filename: string;
  grouping: 'tag' | 'path';
  /** Send to the active environment's baseUrl: the template URL is the path alone. */
  useEnvironment: boolean;
}

const joinUrl = (base: string, path: string) =>
  `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;

export function createTemplateStore(db: Db) {
  const sources = db.collection<TemplateSourceDoc>('templateSources');
  const templates = db.collection<TemplateDoc>('templates');

  return {
    /** Parses and stores; a spec that does not parse throws SpecError and stores nothing. */
    importOpenApi: async (
      input: ImportInput,
    ): Promise<{ sourceId: string; count: number }> => {
      const spec = parseOpenApi(input.text);
      const server = spec.servers[0];
      const sourceId = randomUUID();
      const docs: TemplateDoc[] = [];
      let order = 0;
      for (const [directory, ops] of groupOperations(
        spec.operations,
        input.grouping,
      )) {
        for (const op of ops) {
          docs.push({
            _id: randomUUID(),
            sourceId,
            order: order++,
            directory,
            name: op.name,
            request: {
              method: op.method,
              url:
                input.useEnvironment || !server
                  ? op.path
                  : joinUrl(server, op.path),
              queryRows: op.queryRows,
              headerRows: op.headerRows,
              body: op.body,
            },
          });
        }
      }
      await sources.insertOne({
        _id: sourceId,
        name: spec.title,
        kind: 'openapi',
        filename: input.filename,
        grouping: input.grouping,
        importedAt: new Date(),
      });
      if (docs.length > 0) await templates.insertMany(docs);
      return { sourceId, count: docs.length };
    },

    /** Every source with its templates, in import order then spec order; no request bodies. */
    list: async (): Promise<TemplateSourceListing[]> => {
      const all = await sources.find({}).sort({ importedAt: 1 }).toArray();
      const rows = await templates
        .find({}, { projection: { 'request.body': 0 } })
        .sort({ order: 1 })
        .toArray();
      return all.map((source) => ({
        id: source._id,
        name: source.name,
        kind: source.kind,
        importedAt: source.importedAt,
        templates: rows
          .filter((t) => t.sourceId === source._id)
          .map((t) => ({
            id: t._id,
            directory: t.directory,
            name: t.name,
            method: t.request.method,
            path: pathOf(t.request.url),
          })),
      }));
    },

    get: async (
      id: string,
    ): Promise<{ id: string; name: string; request: WireInput } | null> => {
      const doc = await templates.findOne({ _id: id });
      return doc ? { id: doc._id, name: doc.name, request: doc.request } : null;
    },
  };
}

function pathOf(url: string): string {
  if (url.startsWith('/')) return url;
  try {
    return decodeURI(new URL(url).pathname);
  } catch {
    return url;
  }
}
