import { contextBridge, ipcRenderer } from 'electron';
import { POCKET_IPC, type PocketApi } from '../shared/pocket-ipc';

const call = <T>(channel: string, arg?: unknown) => ipcRenderer.invoke(channel, arg) as Promise<T>;

const api: PocketApi = {
  status: () => call(POCKET_IPC.status),
  list: () => call(POCKET_IPC.list),
  create: (i) => call(POCKET_IPC.create, i),
  pickFolder: () => call(POCKET_IPC.pickFolder),
  start: (taskId) => call(POCKET_IPC.start, { taskId }),
  interrupt: (taskId) => call(POCKET_IPC.interrupt, { taskId }),
  cancel: (taskId) => call(POCKET_IPC.cancel, { taskId }),
  approval: (approvalRequestId, decision) => call(POCKET_IPC.approval, { approvalRequestId, decision }),
  resume: (i) => call(POCKET_IPC.resume, i),
  approveReview: (taskId) => call(POCKET_IPC.approveReview, { taskId }),
  acceptAsIs: (taskId) => call(POCKET_IPC.acceptAsIs, { taskId }),
  evidence: (taskId) => call(POCKET_IPC.evidence, { taskId }),
  evidenceGit: (taskId) => call(POCKET_IPC.evidenceGit, { taskId }),
  resolveEffect: (effectId, resolution) => call(POCKET_IPC.resolveEffect, { effectId, resolution }),
  ack: (taskId) => call(POCKET_IPC.ack, { taskId }),
  resolveReconcile: (taskId, to) => call(POCKET_IPC.resolveReconcile, { taskId, to }),
  onChanged: (cb) => { ipcRenderer.on(POCKET_IPC.changed, (_e, tasks) => cb(tasks)); },
};

contextBridge.exposeInMainWorld('pocket', api);
