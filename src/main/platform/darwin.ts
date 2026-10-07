import type { Platform } from './types';

export const darwin: Platform = {
  relaunchArgs: () => null,
  autostart: { supported: true, label: 'Abrir ao iniciar o sistema' },
  whichCommand: 'which',
  needsShell: () => false,
};
