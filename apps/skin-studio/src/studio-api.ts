// Contrato entre o servidor do Studio e o editor no navegador.
import type { SkinReport } from '@tera/skin-kit/validate';

export interface SkinFile {
  /** Caminho relativo à pasta da skin, com / */
  path: string;
  width: number;
  height: number;
}

export interface SkinState {
  name: string;
  size: number;
  facing: 'left' | 'right';
  rigFile: string;
  /** rig.json como está no disco (pode ter erro; null = ilegível) */
  rig: unknown;
  files: SkinFile[];
  report: SkinReport;
}

export type { SkinReport };
