// Request templates imported from specs (slice 10, openapi-import). A source is one imported file; its templates are
// one per operation, filed into directories. Templates are form content (WireInput): opening one loads the form,
// unlinked, and nothing here touches History (roadmap M2 decision).
import { randomUUID } from 'node:crypto';
import type { AnyBulkWriteOperation, Db } from 'mongodb';
import { groupOperations, parseOpenApi } from './openapi';
import { groupPorts, parseWsdl, soapTemplate } from './wsdl';
import type { WireInput } from './wire';

export interface TemplateSourceDoc {
  _id: string;
  name: string;
  kind: TemplateKind;
  filename: string;
  grouping: 'tag' | 'path' | 'port';
  importedAt: Date;
  /** When first imported; the tree keeps this order across re-imports (code review of reimport-and-errors, 6). */
  createdAt?: Date;
}

export interface TemplateDoc {
  _id: string;
  sourceId: string;
  /** Position within the source, so the tree keeps the spec's order. */
  order: number;
  directory: string;
  name: string;
  request: WireInput;
  /** `METHOD path` as the spec states it: what a re-import matches on, whatever the URL became (code review, 2). */
  key?: string;
  /** What the tree shows in place of the path: a SOAP operation's name (slice 12). */
  label?: string;
}

export interface TemplateListing {
  id: string;
  directory: string;
  name: string;
  method: string;
  path: string;
  /** What the tree's badge says: the method, or SOAP for a WSDL operation (code review of wsdl-import, 9). */
  badge: string;
}

export interface TemplateSourceListing {
  id: string;
  name: string;
  kind: TemplateKind;
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
  /**
   * 'new' refuses to overwrite a source with the same title; 'reimport' updates it in place. The caller says which
   * it showed the user (code review of reimport-and-errors, 7).
   */
  mode?: 'new' | 'reimport';
}

export class ImportConflictError extends Error {}

export type TemplateKind = 'openapi' | 'wsdl';

type Planned = Omit<TemplateDoc, '_id' | 'sourceId'>;

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

  // Stores planned templates as a new source, or updates the source of the same kind and title in place (slice 11).
  async function storePlanned(p: {
    kind: TemplateKind;
    title: string;
    titled: boolean;
    untitledName: string;
    filename: string;
    grouping: 'tag' | 'path' | 'port';
    mode?: 'new' | 'reimport';
    planned: Planned[];
  }): Promise<ImportOutcome> {
    // The same spec is the same kind and title: it is updated in place (slice 11). An untitled spec is always new.
    const name = p.titled ? p.title : p.untitledName;
    const existing = p.titled
      ? await sources
          .find({ kind: p.kind, name })
          .sort({ createdAt: 1, importedAt: 1 })
          .toArray()
      : [];
    const keep = existing[0];
    if (keep && (p.mode ?? 'reimport') === 'new') {
      throw new ImportConflictError(
        `“${name}” is already imported. Choose the file again to re-import it in place.`,
      );
    }
    if (keep) {
      // Copies left by slice 10, which allowed the same title twice, fold into the oldest (code review, 5).
      const copies = existing.slice(1).map((s) => s._id);
      if (copies.length > 0) {
        await templates.deleteMany({ sourceId: { $in: copies } });
        await sources.deleteMany({ _id: { $in: copies } });
      }
      const keyOf = (t: TemplateDoc) =>
        t.key ?? `${t.request.method} ${pathOf(t.request.url)}`;
      const current = await templates.find({ sourceId: keep._id }).toArray();
      const byKey = new Map(current.map((t) => [keyOf(t), t]));
      const kept = new Set<string>();
      const writes: AnyBulkWriteOperation<TemplateDoc>[] = [];
      let added = 0;
      let updated = 0;
      for (const doc of p.planned) {
        const match = byKey.get(doc.key as string);
        if (match && !kept.has(match._id)) {
          kept.add(match._id);
          writes.push({
            replaceOne: {
              filter: { _id: match._id },
              replacement: { ...doc, sourceId: keep._id },
            },
          });
          updated += 1;
        } else {
          writes.push({
            insertOne: {
              document: { ...doc, _id: randomUUID(), sourceId: keep._id },
            },
          });
          added += 1;
        }
      }
      const gone = current.filter((t) => !kept.has(t._id)).map((t) => t._id);
      if (gone.length > 0) {
        writes.push({ deleteMany: { filter: { _id: { $in: gone } } } });
      }
      // One call for every template change (code review, 3 and 9).
      if (writes.length > 0) await templates.bulkWrite(writes);
      await sources.updateOne(
        { _id: keep._id },
        {
          $set: {
            filename: p.filename,
            grouping: p.grouping,
            importedAt: new Date(),
            createdAt: keep.createdAt ?? keep.importedAt,
          },
        },
      );
      return {
        sourceId: keep._id,
        count: p.planned.length,
        reimported: true,
        added,
        updated,
        removed: gone.length,
      };
    }

    const sourceId = randomUUID();
    const docs = p.planned.map((doc) => ({
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
        name,
        kind: p.kind,
        filename: p.filename,
        grouping: p.grouping,
        importedAt: new Date(),
        createdAt: new Date(),
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
  }

  return {
    /** Parses and stores; a spec that does not parse throws SpecError and stores nothing. */
    importOpenApi: async (input: ImportInput): Promise<ImportOutcome> => {
      const spec = parseOpenApi(input.text);
      const server = sendableServer(spec.servers[0]);
      const planned: Planned[] = [];
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
            key: `${op.method} ${op.path}`,
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

      return storePlanned({
        kind: 'openapi',
        title: spec.title,
        titled: spec.titled,
        untitledName: `Untitled API (${input.filename})`,
        filename: input.filename,
        grouping: input.grouping,
        mode: input.mode,
        planned,
      });
    },

    /** Slice 12: one SOAP template per WSDL operation, filed by port; re-imported in place like OpenAPI. */
    importWsdl: async (input: {
      text: string;
      filename: string;
      mode?: 'new' | 'reimport';
    }): Promise<ImportOutcome> => {
      const wsdl = parseWsdl(input.text);
      const planned: Planned[] = [];
      let order = 0;
      // One directory rule with the dialog's preview (code review of wsdl-import, 8).
      for (const [directory, port] of groupPorts(wsdl)) {
        for (const op of port.operations) {
          // An overload is told apart by its input name (code review, 7).
          const label = op.inputName ? `${op.name} (${op.inputName})` : op.name;
          planned.push({
            order: order++,
            directory,
            name: label,
            key: `${directory} ${label}`,
            label,
            request: soapTemplate(port, op),
          });
        }
      }
      return storePlanned({
        kind: 'wsdl',
        title: wsdl.title,
        titled: wsdl.titled,
        untitledName: `Untitled service (${input.filename})`,
        filename: input.filename,
        grouping: 'port',
        mode: input.mode,
        planned,
      });
    },

    /** Every source with its templates, in import order then spec order; no request bodies. */
    list: async (): Promise<TemplateSourceListing[]> => {
      const all = await sources
        .find({})
        .sort({ createdAt: 1, importedAt: 1 })
        .toArray();
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
          path: t.label ?? pathOf(t.request.url),
          badge: source.kind === 'wsdl' ? 'SOAP' : t.request.method,
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
