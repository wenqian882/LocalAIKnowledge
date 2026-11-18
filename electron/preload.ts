import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { DesktopApi, Result } from '../shared/types';
async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const result: Result<T> = await ipcRenderer.invoke(channel, ...args);
  if (!result.ok) throw new Error(result.error);
  return result.data;
}
const api: DesktopApi = {
  setInference: (input) => invoke('models:inference', input),
  selectModel: (input) => invoke('models:select', input),
  listModels: (id) => invoke('models:list', id),
  modelSettings: () => invoke('models:get'),
  saveModel: (input) => invoke('models:save', input),
  testModel: (input) => invoke('models:test', input),
  removeModelKey: (id) => invoke('models:remove-key', id),
  useDemo: () => invoke('models:demo'),
  cancelGeneration: () => invoke('models:cancel'),
  snapshot: () => invoke('data:snapshot'),
  saveKnowledge: (input, id) => invoke('knowledge:save', input, id),
  deleteKnowledge: (id) => invoke('knowledge:delete', id),
  files: (id) => invoke('files:list', id),
  importFiles: (id, files) =>
    invoke(
      'files:import',
      id,
      files?.map((file) => webUtils.getPathForFile(file)),
    ),
  readFile: (id) => invoke('files:read', id),
  removeFile: (id) => invoke('files:remove', id),
  createConversation: () => invoke('conversations:create'),
  setKnowledge: (id, kbIds) => invoke('conversations:knowledge', id, kbIds),
  messages: (id) => invoke('messages:list', id),
  sendMessage: (id, text) => invoke('messages:send', id, text),
};
contextBridge.exposeInMainWorld('desktop', api);
