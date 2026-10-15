// Alterna entre a Tera completa (padrão) e o Mini Companion (experimental).
// No modo mini as Teras completas continuam existindo e recebendo eventos, só escondidas:
// voltar pro modo completo não perde nada.
import type { EntityManager } from './manager';
import { createCompanion, destroyCompanion, getCompanion } from './companion';
import type { Menu } from 'electron';

export type UiMode = 'classic' | 'mini';

let manager: EntityManager | null = null;
let buildMenu: (() => Menu) | null = null;

export const uiMode = (): UiMode => manager?.settings.ui ?? 'classic';

export function initUi(m: EntityManager, menu: () => Menu): void {
  manager = m;
  buildMenu = menu;
  m.onVisibilityChange = (visible) => getCompanion()?.window.setVisible(visible);
  apply(uiMode());
}

export function setUiMode(mode: UiMode): void {
  if (!manager || mode === uiMode()) return;
  manager.saveSettings({ ui: mode });
  apply(mode);
}

function apply(mode: UiMode): void {
  if (!manager || !buildMenu) return;
  const m = manager;
  if (mode === 'mini') {
    createCompanion({
      position: m.settings.companion,
      muted: m.settings.companionMuted,
      visible: m.isVisible,
      onSettle: (p) => m.saveSettings({ companion: p }),
      onMutedChange: (muted) => m.saveSettings({ companionMuted: muted }),
      buildMenu,
    });
    m.setSuppressed(true);
  } else {
    m.setSuppressed(false);
    destroyCompanion();
  }
}
