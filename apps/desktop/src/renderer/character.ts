// Interface comum dos personagens: rig 2D (rig/rig-character.ts, o padrão), sprites
// (sprite-character.ts, fallback) e SVG (svg-character.ts, último recurso).
// Uma implementação nova (Live2D, VRM...) só precisa implementar `Character`.
// O desenho é puxado pelo relógio da janela (frame-clock.ts): nada de laço próprio.
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
  /** Movimento reduzido (pedido no menu ou no sistema): sem movimento procedural contínuo */
  setReducedMotion(reduced: boolean): void;
  /** fps que o personagem precisa agora quando a janela está parada (o relógio arredonda pra tela) */
  targetFps(): number;
  /** Desenha um quadro */
  tick(now: number): void;
}
