// Tudo que muda de um sistema pra outro fica atrás desta interface. Pra suportar um
// SO ou ambiente novo: crie `<nome>.ts` aqui, implemente `Platform` e registre em index.ts.
export interface Platform {
  /** Args pra reabrir o app antes de criar qualquer janela; null = nada a fazer */
  relaunchArgs(env: NodeJS.ProcessEnv, argv: string[]): string[] | null;
  autostart: { supported: boolean; label: string };
  /** Comando que resolve um executável no PATH */
  whichCommand: string;
  /** Executáveis que só rodam por um shell (ex.: shims .cmd no Windows) */
  needsShell(executable: string): boolean;
}
