// The operations, called over HTTP on the local server (plan.md, phase 3; ADR 0002). Same `PigeonApi` the desktop
// build's preload exposed, so call sites are unchanged. Each call is a same-origin POST: the browser adds the server's own
// Origin and the HttpOnly session cookie, which the server checks before anything runs. A refused or failed call
// rejects, as a thrown handler rejected `ipcRenderer.invoke`.
import { type PigeonApi, channels } from '../shared/ipc-contract';
import { decode, encode } from '../shared/wire-codec';

const call =
  (channel: string) =>
  async (input?: unknown): Promise<never> => {
    const response = await fetch(`/api/${channel.replace(/^pigeon:/, '')}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: input === undefined ? '' : encode(input),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(
        `${channel}: ${response.status}${text ? ` ${text}` : ''}`,
      );
    }
    return decode(text) as never;
  };

export const pigeon: PigeonApi = {
  send: call(channels.send),
  cancel: call(channels.cancel),
  listCalls: call(channels.listCalls),
  listResponses: call(channels.listResponses),
  deleteCall: call(channels.deleteCall),
  searchCalls: call(channels.searchCalls),
  importOpenApi: call(channels.importOpenApi),
  importWsdl: call(channels.importWsdl),
  listTemplates: call(channels.listTemplates),
  getTemplate: call(channels.getTemplate),
  dbStatus: call(channels.dbStatus),
  getCall: call(channels.getCall),
  replay: call(channels.replay),
  readBody: call(channels.readBody),
  describeBody: call(channels.describeBody),
  listEnvironments: call(channels.listEnvironments),
  saveEnvironment: call(channels.saveEnvironment),
  deleteEnvironment: call(channels.deleteEnvironment),
  setActiveEnvironment: call(channels.setActiveEnvironment),
  listSavedRequests: call(channels.listSavedRequests),
  getSavedRequest: call(channels.getSavedRequest),
  saveSavedRequest: call(channels.saveSavedRequest),
  deleteSavedRequest: call(channels.deleteSavedRequest),
};
