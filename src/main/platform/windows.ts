import type { Platform } from './types';

export const windows: Platform = {
  relaunchArgs: () => null,
  autostart: { supported: true, label: 'Abrir com o Windows' },
  whichCommand: 'where.exe',
  needsShell: (executable) => /\.(cmd|bat)$/i.test(executable),
};
