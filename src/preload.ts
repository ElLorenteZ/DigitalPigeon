// Preload: exposes exactly four named functions on `window.pigeon`. No raw ipcRenderer, no generic
// invoke channel (AGENTS.md). Main validates every message.
import { contextBridge, ipcRenderer } from 'electron';
import { type PigeonApi, channels } from './shared/ipc-contract';

const api: PigeonApi = {
  send: (input) => ipcRenderer.invoke(channels.send, input),
  cancel: (clientRequestId) =>
    ipcRenderer.invoke(channels.cancel, clientRequestId),
  listCalls: () => ipcRenderer.invoke(channels.listCalls),
  dbStatus: () => ipcRenderer.invoke(channels.dbStatus),
};

contextBridge.exposeInMainWorld('pigeon', api);
