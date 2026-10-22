// Processo principal: ciclo de vida do app, IPC, bandeja e menu.
import { app, ipcMain, nativeImage, Tray, type IpcMainEvent } from 'electron';
import path from 'node:path';
import { APP_NAME, CHARACTER_NAME } from '../shared/brand';
import { IPC } from '../shared/ipc';
import { getPort } from '../shared/protocol';
import { loadConfig } from './config';
import type { Entity } from './entity';
import { EntityManager } from './manager';
import { buildMenu } from './menu';
import { offerConnection, onTeraClicked, refreshSpeech } from './connect-flow';
import { assetsDir } from './paths';
import { startEventServer } from './server';
import { loadSkin } from './skins';
import { openPocketWindow, pocketActive, shutdownPocket } from './pocket/window';

let manager: EntityManager;
let tray: Tray | null = null;

/** Registra um handler de IPC já resolvendo de qual Tera veio a mensagem */
function onEntity<A extends unknown[]>(channel: string, fn: (entity: Entity, ...args: A) => void): void {
  ipcMain.on(channel, (e: IpcMainEvent, ...args: unknown[]) => {
    const entity = manager?.byWebContents(e.sender);
    if (entity) fn(entity, ...(args as A));
  });
}

onEntity<[boolean]>(IPC.setIgnoreMouse, (entity, ignore) => entity.setIgnoreMouse(ignore));
onEntity<[number, number]>(IPC.moveBy, (entity, dx, dy) => entity.moveBy(dx, dy));
onEntity(IPC.dragEnd, (entity) => entity.settle());
onEntity<[boolean]>(IPC.walkAllowed, (entity, allowed) => entity.setWalkAllowed(allowed));
onEntity(IPC.contextMenu, (entity) => buildMenu(manager, entity).popup({ window: entity.win }));
onEntity(IPC.clicked, () => onTeraClicked(manager));
ipcMain.handle(IPC.getSkin, () => loadSkin(manager?.skinId));

function createTray(): void {
  // tray@2x.png ao lado é usado automaticamente em telas com escala alta
  tray = new Tray(nativeImage.createFromPath(path.join(assetsDir(), 'icons', 'tray.png')));
  tray.setToolTip(`${APP_NAME} — ${CHARACTER_NAME}`);
  tray.on('click', () => manager.setVisible(true));
  tray.on('right-click', () => tray?.popUpContextMenu(buildMenu(manager)));
}

// Em desenvolvimento, nome próprio: config e trava de instância separadas do app
// instalado, pra dar pra rodar os dois (use TERACOTA_PORT pra mudar a porta).
if (!app.isPackaged) app.setName(`${APP_NAME} Dev`);

// Só uma cópia do app (a porta é uma só)
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.setAppUserModelId('com.teracota.app');

  app.on('second-instance', () => {
    manager?.setVisible(true);
    manager?.broadcast({ state: 'attention', duration: 2500, say: 'Já tô aqui! 👋' });
  });

  app.whenReady().then(() => {
    app.dock?.hide(); // macOS: vive na barra de menus, sem ícone no Dock
    manager = new EntityManager(loadConfig());
    manager.start();
    // depois da saudação: se achar um agente instalado e não conectado, oferece conectar
    setTimeout(() => void offerConnection(manager), 5000);
    void refreshSpeech();
    createTray();
    if (process.env.TERACOTA_POCKET_OPEN === '1') openPocketWindow(); // atalho de desenvolvimento/smoke
    startEventServer(getPort(), {
      onSignal: (signal) => manager.handleSignal(signal),
      onEvent: (incoming) => manager.handleEvent(incoming),
      onMcp: (event) => manager.handleMcp(event),
    });
  });

  // com a bandeja, esconder todas as janelas não fecha o app — só o "Sair"
  app.on('window-all-closed', () => { /* continua na bandeja */ });

  // Tera Pocket: antes de sair, interrompe com limpeza e solta o lock (uma vez; depois deixa o app sair)
  let pocketClosed = false;
  app.on('before-quit', (e) => {
    if (pocketClosed || !pocketActive()) return;
    e.preventDefault();
    pocketClosed = true;
    // no máximo 5 s: se o runner travar, o app fecha mesmo assim (o Job Object e o próximo boot limpam o resto)
    void Promise.race([shutdownPocket().catch(() => undefined), new Promise<void>((r) => setTimeout(r, 5000))]).finally(() => app.quit());
  });
}
