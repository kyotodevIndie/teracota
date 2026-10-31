// Interface comum dos personagens: SVG (svg-character.ts) e sprites (sprite-character.ts).
// Uma implementação nova (Live2D, VRM...) só precisa implementar `Character`.
import type { Point } from '../shared/ipc';
import type { Look } from './look';

/** Movimento que sobrepõe o visual atual */
export type Motion = 'walk' | 'drag' | null;

export interface Character {
  readonly root: HTMLElement;
  /** Visual do estado atual (pose / expressão / animação) */
  show(look: Look): void;
  /** Ícone da atividade ao lado da cabeça */
  setProp(text: string): void;
  /** Andando ou sendo arrastada; null = parada. dir: 1 direita, -1 esquerda */
  setMotion(motion: Motion, dir: 1 | -1): void;
  /** Falando (balão digitando) */
  setTalking(talking: boolean): void;
  /** Balanço enquanto é carregada, em graus (positivo = pés pra direita) */
  setSwing(angle: number): void;
  /** Olha para um ponto (coordenadas da janela); null = olha pra frente */
  lookAt(p: Point | null): void;
  /** O ponto (coordenadas da janela) está em cima do personagem? */
  hitTest(x: number, y: number): boolean;
}
