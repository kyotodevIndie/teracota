// O que o `tera-skin render` pede pra página de render (Electron escondido) e o que volta.
import type { RigManifest } from '@tera/character/rig';

export interface RenderJob {
  rig: RigManifest;
  /** URL da pasta da skin, terminando em / */
  baseUrl: string;
  /** skin.json "size" e "facing" (o movimento do corpo usa o tamanho) */
  size: number;
  facing: 'left' | 'right';
  /** Desenha pivôs e caixas das camadas */
  debug: boolean;
  /** Lado de cada quadrinho, em px */
  cell: number;
  name: string;
}

export interface RenderCell {
  /** Pasta do arquivo: states, poses, expressions, walk, talk */
  group: string;
  file: string;
  label: string;
  /** PNG em data URL */
  png: string;
}

export interface RenderResult {
  cells: RenderCell[];
  /** A folha de conferência (todos os quadrinhos com nome), PNG em data URL */
  sheet: string;
}
