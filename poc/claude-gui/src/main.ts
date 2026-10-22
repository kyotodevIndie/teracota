// Janela experimental da POC: escolher projeto, abrir/retomar sessão, conversar em streaming,
// ver estado/ferramentas e responder permissões. Sem identidade visual de propósito.

import { join } from 'node:path';
import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { AgentSession, findClaude, type ImageInput, listProjectSessions } from './session';

let win: BrowserWindow | null = null;
let session: AgentSession | null = null;
const claudePath = findClaude();

const send = (channel: string, payload: unknown) => win?.webContents.send('poc', channel, payload);

function wire(s: AgentSession) {
  for (const ev of ['state', 'init', 'text', 'tool', 'toolResult', 'fileChanged', 'permission', 'result'] as const) {
    s.on(ev, ((payload: unknown) => send(ev, payload)) as never);
  }
  s.on('error', (e) => send('error', e.message));
}

ipcMain.handle('pickProject', async () => {
  const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('listSessions', async (_e, dir: string) =>
  (await listProjectSessions(dir)).map((s) => ({ id: s.sessionId, title: s.customTitle ?? s.summary, when: s.lastModified })));

ipcMain.handle('open', async (_e, dir: string, resume: string | null, model: string | null) => {
  session?.close();
  session = new AgentSession({ cwd: dir, resume: resume ?? undefined, model: model ?? undefined, claudePath });
  wire(session);
  await session.start();
  return true;
});

ipcMain.handle('send', (_e, text: string, images: ImageInput[]) => session?.send(text, images));
ipcMain.handle('respond', (_e, id: string, allow: boolean, always: boolean) => session?.respond(id, allow, { always }));
ipcMain.handle('interrupt', () => session?.interrupt());

app.whenReady().then(() => {
  win = new BrowserWindow({
    width: 900, height: 760, title: 'Teracota — POC Claude Code',
    webPreferences: { preload: join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
  });
  void win.loadFile(join(__dirname, '..', 'ui', 'index.html'));
});

app.on('window-all-closed', () => { session?.close(); app.quit(); });
