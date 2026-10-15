// Decisão pura de como obter a pasta de trabalho (testável sem Electron).
import { SIM_PROVIDER_ID } from '../bridge/simulated';

export interface PickFolderDeps {
  /** Cria uma pasta temporária descartável (só a simulação usa) */
  makeTemp(): string;
  /** Abre o seletor do sistema; null se cancelado */
  openDialog(): Promise<string | null>;
}

/** Simulação ligada: pasta temporária sem diálogo. Qualquer outro caso: o seletor do sistema (é o consentimento). */
export async function resolvePickFolder(providerId: string, simEnabled: boolean, deps: PickFolderDeps): Promise<string | null> {
  if (providerId === SIM_PROVIDER_ID && simEnabled) return deps.makeTemp();
  return deps.openDialog();
}
