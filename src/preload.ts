// Preload: exposes exactly sixteen named functions on `window.pigeon`. No raw ipcRenderer, no generic
// invoke channel (AGENTS.md). Main validates every message.
import { contextBridge, ipcRenderer } from 'electron';
import { type PigeonApi, channels } from './shared/ipc-contract';

const api: PigeonApi = {
  send: (input) => ipcRenderer.invoke(channels.send, input),
  cancel: (clientRequestId) =>
    ipcRenderer.invoke(channels.cancel, clientRequestId),
  listCalls: () => ipcRenderer.invoke(channels.listCalls),
  dbStatus: () => ipcRenderer.invoke(channels.dbStatus),
  getCall: (sendId) => ipcRenderer.invoke(channels.getCall, sendId),
  replay: (input) => ipcRenderer.invoke(channels.replay, input),
  readBody: (input) => ipcRenderer.invoke(channels.readBody, input),
  describeBody: (input) => ipcRenderer.invoke(channels.describeBody, input),
  listEnvironments: () => ipcRenderer.invoke(channels.listEnvironments),
  saveEnvironment: (input) =>
    ipcRenderer.invoke(channels.saveEnvironment, input),
  deleteEnvironment: (id) => ipcRenderer.invoke(channels.deleteEnvironment, id),
  setActiveEnvironment: (id) =>
    ipcRenderer.invoke(channels.setActiveEnvironment, id),
  listSavedRequests: () => ipcRenderer.invoke(channels.listSavedRequests),
  getSavedRequest: (id) => ipcRenderer.invoke(channels.getSavedRequest, id),
  saveSavedRequest: (input) =>
    ipcRenderer.invoke(channels.saveSavedRequest, input),
  deleteSavedRequest: (id) =>
    ipcRenderer.invoke(channels.deleteSavedRequest, id),
};

contextBridge.exposeInMainWorld('pigeon', api);
