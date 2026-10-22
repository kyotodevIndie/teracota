// Janela "Tera Pocket" (tarefas). Janela comum, separada do companion: não mexe em transparência,
// click-through, bandeja nem na janela da Tera. O serviço sobe sob demanda, na primeira abertura.
import { app, BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { POCKET_IPC, type PocketChannel, type PocketResult } from '../../shared/pocket-ipc';
import { createPocketHandlers, runHandler } from './ipc';
import { PocketService } from './service';

let win: BrowserWindow | null = null;
let service: PocketService | null = null;
let starting: Promise<void> | null = null;
let startError: string | null = null;
let shuttingDown = false;
let registered = false;

const PAGE = () => path.join(__dirname, 'renderer', 'pocket.html');

function trusted(e: IpcMainInvokeEvent): boolean {
  if (!win || win.isDestroyed()) return false;
  const url = (e.senderFrame?.url ?? '').split('#')[0]?.split('?')[0] ?? '';
  // igualdade EXATA com a página local (nada de includes: 'file:///x/pocket.html.evil' não passa)
  return e.sender === win.webContents && e.senderFrame === win.webContents.mainFrame && url === pathToFileURL(PAGE()).href;
}

function notify(): void {
  if (!win || win.isDestroyed() || !service) return;
  try { win.webContents.send(POCKET_IPC.changed, service.orch.listViews()); } catch { /* janela fechando */ }
}

async function ensureService(): Promise<void> {
  if (service || shuttingDown) return;
  starting ??= (async () => {
    try {
      service = await PocketService.start({
        dataDir: path.join(app.getPath('userData'), 'pocket'),
        pickFolder: async () => {
          const r = await dialog.showOpenDialog(win ?? undefined as never, { properties: ['openDirectory'], title: 'Pasta de trabalho da tarefa' });
          return r.canceled ? null : (r.filePaths[0] ?? null);
        },
        onChanged: notify,
        extraProtected: [app.getAppPath(), path.dirname(process.execPath), app.getPath('userData')],
      });
      startError = null;
    } catch (e) {
      startError = (e as { code?: string }).code === 'LOCK_BUSY'
        ? 'Outra instância da Tera Pocket já está com o banco aberto.'
        : `Não foi possível iniciar a Tera Pocket: ${(e as Error).message.slice(0, 200)}`;
    } finally { starting = null; }
  })();
  await starting;
}

function register(): void {
  if (registered) return;
  registered = true;
  for (const channel of Object.values(POCKET_IPC)) {
    if (channel === POCKET_IPC.changed) continue;
    ipcMain.handle(channel, async (e, arg): Promise<PocketResult> => {
      if (!trusted(e)) return { ok: false, code: 'UNTRUSTED', message: 'origem não autorizada' };
      await ensureService();
      if (!service) {
        if (channel === POCKET_IPC.status) {
          return { ok: true, data: { ready: false, blocked: startError ?? 'serviço indisponível', claudeFound: false, containment: 'none', orphansKilled: 0 } };
        }
        return { ok: false, code: 'UNAVAILABLE', message: startError ?? 'serviço indisponível' };
      }
      if (service.blocked && channel !== POCKET_IPC.status && channel !== POCKET_IPC.list) {
        return { ok: false, code: 'BLOCKED', message: service.blocked };
      }
      const handlers = createPocketHandlers(service);
      return runHandler(handlers[channel as PocketChannel], arg);
    });
  }
}

export function openPocketWindow(): void {
  register();
  if (win && !win.isDestroyed()) { win.show(); win.focus(); return; }
  win = new BrowserWindow({
    width: 1040, height: 720, minWidth: 760, minHeight: 520, title: 'Tera Pocket', autoHideMenuBar: true,
    backgroundColor: '#1b1b1f',
    webPreferences: {
      preload: path.join(__dirname, 'pocket-preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false,
      webSecurity: true, devTools: !app.isPackaged,
    },
  });
  win.setMenu(null);
  // a janela só carrega a própria página local; nada de navegação nem janelas novas
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (ev) => ev.preventDefault());
  win.on('closed', () => { win = null; });
  void win.loadFile(PAGE());
  void ensureService().then(notify);
}

/** Chamado em `before-quit`: interrompe com limpeza e solta o lock. */
export async function shutdownPocket(): Promise<void> {
  shuttingDown = true;
  if (starting) await starting.catch(() => undefined);
  const s = service;
  service = null;
  if (s) await s.shutdown();
}

export function pocketActive(): boolean { return service !== null || starting !== null; }
