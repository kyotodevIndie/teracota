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
import { offerConnection, refreshSpeech } from './connect-flow';
import { assetsDir } from './paths';
import { startEventServer } from './server';
import { loadFallbackSkin, loadSkin } from './skins';
import { getAgentPanel, initAgentPanel } from './panel';
import { usageStore } from './usage';
import { PluginHost } from './plugins/host';
import { RemoteServer } from './remote/server';
import { REMOTE_DEFAULT_PORT } from '../shared/remote';

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
onEntity<[unknown]>(IPC.setShape, (entity, rects) => entity.setShape(rects));
onEntity<[number, number]>(IPC.moveBy, (entity, dx, dy) => entity.moveBy(dx, dy));
onEntity(IPC.dragEnd, (entity) => entity.settle());
onEntity<[number, number]>(IPC.walkTo, (entity, x, y) => {
  if (Number.isFinite(x) && Number.isFinite(y)) entity.walkTo({ x, y });
});
onEntity(IPC.walkArrived, (entity) => entity.walkArrived());
onEntity<[boolean]>(IPC.walkAllowed, (entity, allowed) => entity.setWalkAllowed(allowed));
onEntity(IPC.contextMenu, (entity) => buildMenu(manager, entity).popup({ window: entity.win }));
// clique na Tera (não arrasto, não carinho): abre a interface ou traz pra frente
onEntity(IPC.clicked, () => getAgentPanel()?.toggle());
ipcMain.handle(IPC.getSkin, () => loadSkin(manager?.skinId));
ipcMain.handle(IPC.getFallbackSkin, () => loadFallbackSkin());

function createTray(): void {
  // tray@2x.png ao lado é usado automaticamente em telas com escala alta
  tray = new Tray(nativeImage.createFromPath(path.join(assetsDir(), 'icons', 'tray.png')));
  tray.setToolTip(`${APP_NAME} — ${CHARACTER_NAME}`);
  // recuperar a Tera: mostra e traz de volta pra tela se ela estiver num lugar invisível
  tray.on('click', () => {
    manager.setVisible(true);
    manager.ensureOnScreen();
  });
  tray.on('right-click', () => tray?.popUpContextMenu(buildMenu(manager)));
}

// Linux com Wayland: o protocolo não deixa uma janela se posicionar nem ficar sempre no
// topo, então a Tera não conseguiria passear nem ser arrastada. Roda via XWayland, que
// permite as duas coisas (medido: em Wayland nativo as coordenadas da janela não valem).
// A plataforma é escolhida antes deste script rodar (appendSwitch aqui chega tarde), então
// o app se reabre uma vez com --ozone-platform=x11. Quem passar --ozone-platform decide.
const relaunchingForX11 = needsX11Relaunch();
if (relaunchingForX11) {
  app.relaunch({
    execPath: process.env.APPIMAGE ?? process.execPath, // AppImage: reabrir o arquivo, não o ponto de montagem
    args: [...process.argv.slice(1), '--ozone-platform=x11'],
  });
  app.exit(0);
}

function needsX11Relaunch(): boolean {
  if (process.platform !== 'linux' || process.env.XDG_SESSION_TYPE !== 'wayland') return false;
  // o Electron põe --ozone-platform=wayland no próprio commandLine quando detecta sozinho,
  // então só a linha de comando de verdade (argv) diz se alguém escolheu
  return !process.argv.some((a) => a.startsWith('--ozone-platform'));
}

// Em desenvolvimento, nome próprio: config e trava de instância separadas do app
// instalado, pra dar pra rodar os dois (use TERACOTA_PORT pra mudar a porta).
if (!app.isPackaged) app.setName(`${APP_NAME} Dev`);

// Só uma cópia do app (a porta é uma só)
if (relaunchingForX11) {
  // saindo: a cópia reaberta em XWayland assume
} else if (!app.requestSingleInstanceLock()) {
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
    const panel = initAgentPanel({ onSignal: (s) => manager.handleSignal(s), manager });
    // plugins: cada um isolado numa página escondida (plugins/host.ts)
    const plugins = new PluginHost({
      dir: process.env.TERACOTA_PLUGINS_DIR || path.join(app.getPath('userData'), 'plugins'),
      config: () => manager.pluginConfig,
      saveConfig: (p) => manager.setPluginConfig(p),
      say: (text, expression, from) => manager.broadcast({ say: text, from, ...(expression && { expression }) }),
      signal: (s) => manager.handleSignal(s),
      usage: (provider, windows) => usageStore.set(provider, windows),
      changed: () => panel.pluginsChanged(),
    }, __dirname);
    panel.setPlugins(plugins);
    plugins.start();
    // celular na rede de casa (desligado até o usuário ligar nos Ajustes)
    const remote = new RemoteServer({
      port: Number(process.env.TERACOTA_REMOTE_PORT) || REMOTE_DEFAULT_PORT,
      webDir: path.join(__dirname, 'mobile'),
      enabled: () => manager.remoteConfig.enabled,
      setEnabled: (on) => manager.setRemoteConfig({ ...manager.remoteConfig, enabled: on }),
      devices: () => manager.remoteConfig.devices,
      saveDevices: (devices) => manager.setRemoteConfig({ ...manager.remoteConfig, devices }),
      snapshot: () => panel.remoteSnapshot(),
      changed: () => panel.remoteChanged(),
    });
    panel.setRemote(remote);
    remote.start();
    app.on('before-quit', () => remote.stop());
    app.on('before-quit', () => plugins.stopAll());
    // depois da saudação: se achar um agente instalado e não conectado, oferece conectar
    setTimeout(() => void offerConnection(manager), 5000);
    void refreshSpeech();
    createTray();
    startEventServer(getPort(), {
      onSignal: (signal) => manager.handleSignal(signal),
      onEvent: (incoming) => manager.handleEvent(incoming),
      onMcp: (event) => manager.handleMcp(event),
      onUsage: (provider, windows) => usageStore.set(provider, windows),
      onPlugin: (id, subpath, body) => plugins.http(id, subpath, body),
    });
  });

  // com a bandeja, esconder todas as janelas não fecha o app — só o "Sair"
  app.on('window-all-closed', () => { /* continua na bandeja */ });
}
