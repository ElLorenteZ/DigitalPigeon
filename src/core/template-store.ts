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

export interface ImportOutcome {
  sourceId: string;
  count: number;
  /** True when a source with the same kind and title existed and was updated in place (slice 11). */
  reimported: boolean;
  added: number;
  updated: number;
  removed: number;
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

// A server URL the form can send: http(s), and no {variables} in it. Otherwise the template takes the path alone and
// goes to the active environment (code review of openapi-import, 2).
function sendableServer(server: string | undefined): string | undefined {
  if (!server || /[{}]/.test(server)) return undefined;
  try {
    const url = new URL(server);
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? server
      : undefined;
  } catch {
    return undefined;
  }
}

export function createTemplateStore(db: Db) {
  const sources = db.collection<TemplateSourceDoc>('templateSources');
  const templates = db.collection<TemplateDoc>('templates');

  return {
    /** Parses and stores; a spec that does not parse throws SpecError and stores nothing. */
    importOpenApi: async (input: ImportInput): Promise<ImportOutcome> => {
      const spec = parseOpenApi(input.text);
      const server = sendableServer(spec.servers[0]);
      const planned: Omit<TemplateDoc, '_id' | 'sourceId'>[] = [];
      let order = 0;
      for (const [directory, ops] of groupOperations(
        spec.operations,
        input.grouping,
      )) {
        for (const op of ops) {
          planned.push({
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

      // The same spec is the same kind and title: it is updated in place (slice 11).
      const existing = await sources.findOne({
        kind: 'openapi',
        name: spec.title,
      });
      if (existing) {
        const keyOf = (t: { request: WireInput }) =>
          `${t.request.method} ${pathOf(t.request.url)}`;
        const current = await templates
          .find({ sourceId: existing._id })
          .toArray();
        const byKey = new Map(current.map((t) => [keyOf(t), t]));
        let added = 0;
        let updated = 0;
        const kept = new Set<string>();
        for (const doc of planned) {
          const match = byKey.get(keyOf(doc));
          if (match && !kept.has(match._id)) {
            kept.add(match._id);
            await templates.replaceOne(
              { _id: match._id },
              { ...doc, sourceId: existing._id },
            );
            updated += 1;
          } else {
            await templates.insertOne({
              ...doc,
              _id: randomUUID(),
              sourceId: existing._id,
            });
            added += 1;
          }
        }
        const gone = current.filter((t) => !kept.has(t._id)).map((t) => t._id);
        if (gone.length > 0) await templates.deleteMany({ _id: { $in: gone } });
        await sources.updateOne(
          { _id: existing._id },
          {
            $set: {
              filename: input.filename,
              grouping: input.grouping,
              importedAt: new Date(),
            },
          },
        );
        return {
          sourceId: existing._id,
          count: planned.length,
          reimported: true,
          added,
          updated,
          removed: gone.length,
        };
      }

      const sourceId = randomUUID();
      const docs = planned.map((doc) => ({
        ...doc,
        _id: randomUUID(),
        sourceId,
      }));
      // Templates first, then their source: a failure part-way leaves nothing listed (code review of
      // openapi-import, 4).
      if (docs.length > 0) await templates.insertMany(docs);
      try {
        await sources.insertOne({
          _id: sourceId,
          name: spec.title,
          kind: 'openapi',
          filename: input.filename,
          grouping: input.grouping,
          importedAt: new Date(),
        });
      } catch (error) {
        await templates.deleteMany({ sourceId }).catch(() => undefined);
        throw error;
      }
      return {
        sourceId,
        count: docs.length,
        reimported: false,
        added: docs.length,
        updated: 0,
        removed: 0,
      };
    },

    /** Every source with its templates, in import order then spec order; no request bodies. */
    list: async (): Promise<TemplateSourceListing[]> => {
      const all = await sources.find({}).sort({ importedAt: 1 }).toArray();
      const rows = await templates
        .find({}, { projection: { 'request.body': 0 } })
        .sort({ order: 1 })
        .toArray();
      // One pass to group by source (code review of openapi-import, 7).
      const bySource = new Map<string, TemplateDoc[]>();
      for (const row of rows) {
        const group = bySource.get(row.sourceId);
        if (group) group.push(row as TemplateDoc);
        else bySource.set(row.sourceId, [row as TemplateDoc]);
      }
      return all.map((source) => ({
        id: source._id,
        name: source.name,
        kind: source.kind,
        importedAt: source.importedAt,
        templates: (bySource.get(source._id) ?? []).map((t) => ({
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
