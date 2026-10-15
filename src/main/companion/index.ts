// Liga a janela compacta, o controller e o IPC. Uma instância por app.
import { app, ipcMain, type IpcMainEvent, type Menu } from 'electron';
import { COMPANION_IPC, type CompanionInput } from '../../shared/companion';
import type { Point } from '../../shared/ipc';
import { CompanionController } from './controller';
import { isScenario, runScenario } from './simulator';
import { CompanionWindow } from './window';

export interface CompanionOptions {
  position?: Point;
  muted?: boolean;
  visible?: boolean;
  onSettle: (p: Point) => void;
  onMutedChange: (muted: boolean) => void;
  /** Menu completo (o mesmo da Tera e da bandeja) */
  buildMenu: () => Menu;
}

export class Companion {
  readonly window: CompanionWindow;
  readonly controller: CompanionController;

  constructor(private readonly opts: CompanionOptions) {
    this.window = new CompanionWindow({
      position: opts.position,
      visible: opts.visible,
      onSettle: opts.onSettle,
      onAnchorChange: () => this.controller.render(true),
      onMenu: () => this.popupMenu(),
    });
    this.controller = new CompanionController(this.window, { muted: opts.muted, onMutedChange: opts.onMutedChange });
    this.window.win.webContents.on('did-finish-load', () => this.controller.render(true));
    this.controller.render(true);
  }

  popupMenu(): void {
    const menu = this.opts.buildMenu();
    this.controller.setPanelOpen(true);
    menu.once('menu-will-close', () => this.controller.setPanelOpen(false));
    menu.popup({ window: this.window.win });
  }

  destroy(): void {
    this.window.destroy();
  }
}

let current: Companion | null = null;

export const getCompanion = (): Companion | null => current;

export function createCompanion(opts: CompanionOptions): Companion {
  current?.destroy();
  current = new Companion(opts);
  return current;
}

export function destroyCompanion(): void {
  current?.destroy();
  current = null;
}

/** IPC da janela compacta: só aceita mensagens da própria janela */
function onCompanion<A extends unknown[]>(channel: string, fn: (c: Companion, ...args: A) => void): void {
  ipcMain.on(channel, (e: IpcMainEvent, ...args: unknown[]) => {
    if (current?.window.alive && e.sender === current.window.win.webContents) fn(current, ...(args as A));
  });
}

export function registerCompanionIpc(getSkin: () => unknown): void {
  onCompanion<[boolean]>(COMPANION_IPC.setIgnoreMouse, (c, ignore) => c.window.setIgnoreMouse(ignore));
  onCompanion<[number, number]>(COMPANION_IPC.moveBy, (c, dx, dy) => c.window.moveBy(dx, dy));
  onCompanion(COMPANION_IPC.dragEnd, (c) => c.window.settle());
  onCompanion(COMPANION_IPC.contextMenu, (c) => c.popupMenu());
  onCompanion<[CompanionInput]>(COMPANION_IPC.input, (c, input) => {
    if (input && typeof input === 'object' && typeof input.type === 'string') c.controller.input(input);
  });
  onCompanion<[string]>(COMPANION_IPC.simulate, (c, scenario) => {
    if (!app.isPackaged && isScenario(scenario)) runScenario(c.controller, scenario);
  });
  ipcMain.handle(COMPANION_IPC.getSkin, () => getSkin());
}
