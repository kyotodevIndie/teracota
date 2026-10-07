import type { Platform } from './types';

const XWAYLAND_FLAG = '--ozone-platform=x11';

export const linux: Platform = {
  // Wayland ignora a posição pedida pela janela, então a Tera não fica no canto nem
  // passeia; via XWayland funciona. A plataforma é escolhida antes do main rodar
  // (appendSwitch tarde demais derruba a GPU), por isso reabrimos com a flag.
  relaunchArgs: (env, argv) =>
    env.XDG_SESSION_TYPE === 'wayland' && !argv.includes(XWAYLAND_FLAG) ? [...argv.slice(1), XWAYLAND_FLAG] : null,
  autostart: { supported: false, label: 'Abrir ao iniciar o sistema' },
  whichCommand: 'which',
  needsShell: () => false,
};
