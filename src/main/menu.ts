// Menu do app — o mesmo no botão direito da Tera e no ícone da bandeja.
import { app, Menu, type MenuItemConstructorOptions } from 'electron';
import { APP_NAME, CHARACTER_NAME } from '../shared/brand';
import { SVG_SKIN_ID } from '../shared/skin';
import { connectAgent, connectOpenSessions, speechEnabled, toggleSpeech } from './connect-flow';
import { ADAPTERS } from './integrations';
import type { Entity } from './entity';
import { MAX_ENTITIES, type EntityManager } from './manager';
import { platform } from './platform';
import { listSkins, loadSkin } from './skins';

function skinItems(manager: EntityManager): MenuItemConstructorOptions[] {
  const current = loadSkin(manager.skinId)?.id ?? SVG_SKIN_ID;
  return [
    ...listSkins().map((s): MenuItemConstructorOptions => ({
      label: s.name, type: 'radio', checked: s.id === current, click: () => manager.setSkin(s.id),
    })),
    { label: 'Clássica (desenho)', type: 'radio', checked: current === SVG_SKIN_ID, click: () => manager.setSkin(SVG_SKIN_ID) },
  ];
}

function connectItems(manager: EntityManager): MenuItemConstructorOptions[] {
  return ADAPTERS.filter((a) => a.connect).flatMap((a): MenuItemConstructorOptions[] => [
    { label: a.connect!.label, click: () => void connectAgent(manager, a) },
    ...(a.connect!.openSessions
      ? [{ label: `Conectar sessões já abertas (${a.displayName})`, click: () => connectOpenSessions(manager, a) }]
      : []),
    ...(a.connect!.speech
      ? [{
        label: `Deixar o ${a.displayName} falar pela Tera`,
        type: 'checkbox' as const,
        checked: speechEnabled(a),
        click: () => void toggleSpeech(manager, a),
      }]
      : []),
  ]);
}

/** @param entity a Tera clicada (ausente quando o menu vem da bandeja) */
export function buildMenu(manager: EntityManager, entity?: Entity): Menu {
  const label = entity?.identity.label;
  const autoStart = app.getLoginItemSettings().openAtLogin;

  const template: MenuItemConstructorOptions[] = [
    ...(label ? [{ label: `📁 ${label}`, enabled: false }, { type: 'separator' as const }] : []),
    manager.isVisible
      ? { label: `Esconder ${CHARACTER_NAME}`, click: () => manager.setVisible(false) }
      : { label: `Mostrar ${CHARACTER_NAME}`, click: () => manager.setVisible(true) },
    { type: 'separator' },
    { label: 'Passear pela tela', type: 'radio', checked: manager.moveMode === 'roam', click: () => manager.setMoveMode('roam') },
    { label: 'Ficar parada', type: 'radio', checked: manager.moveMode === 'stay', click: () => manager.setMoveMode('stay') },
    { type: 'separator' },
    { label: `Uma ${CHARACTER_NAME} só`, type: 'radio', checked: manager.mode === 'single', click: () => manager.setEntityMode('single') },
    {
      label: `Uma por sessão de agente (até ${MAX_ENTITIES})`, type: 'radio', checked: manager.mode === 'multi',
      click: () => manager.setEntityMode('multi'),
    },
    { type: 'separator' },
    { label: 'Skin', submenu: skinItems(manager) },
    { label: 'Voltar pro canto', click: () => (entity ? entity.resetPosition() : manager.resetPositions()) },
    { type: 'separator' },
    ...connectItems(manager),
    ...(platform.autostart.supported
      ? [{
        label: app.isPackaged ? platform.autostart.label : `${platform.autostart.label} (só no app instalado)`,
        type: 'checkbox' as const,
        checked: autoStart,
        enabled: app.isPackaged,
        click: () => app.setLoginItemSettings({ openAtLogin: !autoStart }),
      }]
      : []),
    { type: 'separator' },
    ...(!app.isPackaged && entity
      ? [
        { label: 'Recarregar', click: () => entity.win.reload() },
        { label: 'DevTools', click: () => entity.win.webContents.openDevTools({ mode: 'detach' }) },
        { type: 'separator' as const },
      ]
      : []),
    { label: `Sair do ${APP_NAME}`, click: () => app.quit() },
  ];
  return Menu.buildFromTemplate(template);
}
