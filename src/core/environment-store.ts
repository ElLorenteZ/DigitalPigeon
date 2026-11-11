// Environments: a name plus a baseUrl, editable and deletable, and the one shown as active at startup (plan.md,
// phase 1). Separate from the insert-only call collections: nothing here writes a send or a completion.
import { randomUUID } from 'node:crypto';
import type { Db } from 'mongodb';
import { z } from 'zod';
import type { EnvironmentSnapshot } from './call-schema';
import { NoActiveEnvironmentError, checkBaseUrl, isPath } from './url';

export class EnvironmentNotFoundError extends Error {
  constructor(readonly id: string) {
    super('The chosen environment no longer exists: choose another');
  }
}

export class InvalidEnvironmentError extends Error {}

export type Environment = EnvironmentSnapshot;

const EnvironmentDocSchema = z.strictObject({
  _id: z.string().min(1),
  schemaVersion: z.literal(1),
  name: z.string().min(1),
  baseUrl: z.string().min(1),
  updatedAt: z.date(),
});
type EnvironmentDoc = z.infer<typeof EnvironmentDocSchema>;

const ActiveSettingSchema = z.strictObject({
  _id: z.literal('active-environment'),
  environmentId: z.string().min(1).nullable(),
});
type ActiveSetting = z.infer<typeof ActiveSettingSchema>;

const toEnvironment = (doc: unknown): Environment => {
  const { _id, name, baseUrl } = EnvironmentDocSchema.parse(doc);
  return { id: _id, name, baseUrl };
};

function checked(input: { name: string; baseUrl: string }) {
  const name = input.name.trim();
  if (name === '')
    throw new InvalidEnvironmentError('Give the environment a name');
  return { name, baseUrl: checkBaseUrl(input.baseUrl) };
}

export function createEnvironmentStore(db: Db) {
  const environments = db.collection<EnvironmentDoc>('environments');
  const settings = db.collection<ActiveSetting>('settings');

  const get = async (id: string): Promise<Environment | null> => {
    const doc = await environments.findOne({ _id: id });
    return doc ? toEnvironment(doc) : null;
  };

  return {
    /** By name; environments sharing a name keep the order of their baseUrl. */
    list: async (): Promise<Environment[]> =>
      (await environments.find().sort({ name: 1, baseUrl: 1 }).toArray()).map(
        toEnvironment,
      ),

    get,

    create: async (input: { name: string; baseUrl: string }) => {
      const doc = EnvironmentDocSchema.parse({
        _id: randomUUID(),
        schemaVersion: 1,
        ...checked(input),
        updatedAt: new Date(),
      });
      await environments.insertOne(doc);
      return toEnvironment(doc);
    },

    update: async (
      id: string,
      input: { name: string; baseUrl: string },
    ): Promise<Environment | null> => {
      const doc = await environments.findOneAndUpdate(
        { _id: id },
        { $set: { ...checked(input), updatedAt: new Date() } },
        { returnDocument: 'after' },
      );
      return doc ? toEnvironment(doc) : null;
    },

    /** Deleting the active environment leaves none active. Calls keep their snapshot. */
    delete: async (id: string): Promise<boolean> => {
      const { deletedCount } = await environments.deleteOne({ _id: id });
      await settings.updateOne(
        { _id: 'active-environment', environmentId: id },
        { $set: { environmentId: null } },
      );
      return deletedCount === 1;
    },

    /** The environment shown at startup; null when none is set or it was deleted. */
    getActive: async (): Promise<Environment | null> => {
      const raw = await settings.findOne({ _id: 'active-environment' });
      const setting = raw ? ActiveSettingSchema.parse(raw) : null;
      return setting?.environmentId ? get(setting.environmentId) : null;
    },

    setActive: async (id: string | null): Promise<void> => {
      if (id !== null && !(await get(id)))
        throw new EnvironmentNotFoundError(id);
      await settings.updateOne(
        { _id: 'active-environment' },
        { $set: { environmentId: id } },
        { upsert: true },
      );
    },
  };
}

/**
 * The environment a send uses, loaded by the id its select showed (plan revision 2, B1). A full URL uses none,
 * whatever is chosen (review R1). A path needs one that still exists; both refusals come before anything is recorded.
 */
export async function resolveEnvironment(
  store: Pick<ReturnType<typeof createEnvironmentStore>, 'get'>,
  id: string | null,
  url: string,
): Promise<EnvironmentSnapshot | undefined> {
  if (!isPath(url)) return undefined;
  if (id === null) throw new NoActiveEnvironmentError();
  const environment = await store.get(id);
  if (!environment) throw new EnvironmentNotFoundError(id);
  return environment;
}
