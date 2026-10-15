// Menu do app — o mesmo no botão direito da Tera e no ícone da bandeja.
import { app, Menu, type MenuItemConstructorOptions } from 'electron';
import { APP_NAME, CHARACTER_NAME } from '../shared/brand';
import { SVG_SKIN_ID } from '../shared/skin';
import { connectAgent, connectOpenSessions, speechEnabled, toggleSpeech } from './connect-flow';
import { ADAPTERS } from './integrations';
import type { Entity } from './entity';
import { MAX_ENTITIES, type EntityManager } from './manager';
import { listSkins, loadSkin } from './skins';
import { getCompanion } from './companion';
import { SCENARIOS, runScenario, type Scenario } from './companion/simulator';
import { setUiMode, uiMode } from './ui-mode';

function uiItems(): MenuItemConstructorOptions[] {
  return [
    { label: `${CHARACTER_NAME} completa`, type: 'radio', checked: uiMode() === 'classic', click: () => setUiMode('classic') },
    { label: 'Mini (experimental)', type: 'radio', checked: uiMode() === 'mini', click: () => setUiMode('mini') },
  ];
}

/** Só em desenvolvimento: eventos simulados pro Mini Companion */
function simulatorItems(): MenuItemConstructorOptions[] {
  const companion = getCompanion();
  if (app.isPackaged || !companion) return [];
  return [{
    label: 'Simular (mini)',
    submenu: (Object.entries(SCENARIOS) as [Scenario, string][]).map(([id, label]) => ({
      label,
      click: () => runScenario(companion.controller, id),
    })),
  }];
}

function skinItems(manager: EntityManager): MenuItemConstructorOptions[] {
  const current = loadSkin(manager.skinId)?.id ?? SVG_SKIN_ID;
  return [
    ...listSkins().map((s): MenuItemConstructorOptions => ({
      label: s.name, type: 'radio', checked: s.id === current, click: () => manager.setSkin(s.id),
    })),
    { label: 'Clássica (desenho)', type: 'radio', checked: current === SVG_SKIN_ID, click: () => manager.setSkin(SVG_SKIN_ID) },
  ];
}

const STARTUP_LABEL = process.platform === 'win32' ? 'Abrir com o Windows' : 'Abrir ao iniciar o sistema';

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
    { label: 'Visual', submenu: uiItems() },
    { label: 'Skin', submenu: skinItems(manager) },
    {
      label: 'Voltar pro canto',
      click: () => {
        const companion = getCompanion();
        if (companion) companion.window.resetPosition();
        else if (entity) entity.resetPosition();
        else manager.resetPositions();
      },
    },
    { type: 'separator' },
    ...connectItems(manager),
    {
      label: app.isPackaged ? STARTUP_LABEL : `${STARTUP_LABEL} (só no app instalado)`,
      type: 'checkbox',
      checked: autoStart,
      enabled: app.isPackaged,
      click: () => app.setLoginItemSettings({ openAtLogin: !autoStart }),
    },
    { type: 'separator' },
    ...simulatorItems(),
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
