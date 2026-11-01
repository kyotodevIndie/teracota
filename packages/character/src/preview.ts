// Prévia de um rig num canvas qualquer, com o mesmo motor da Tera no app: cena (camadas),
// RigAnimator (pose, expressão, piscada, boca, olhar, passos) e o movimento do corpo
// inteiro (wobble). Usada pelo Skin Studio e pelo `tera-skin render`; o app usa a mesma
// conta em RigCharacter, com o arrasto e o clique por cima.
import { RigAnimator, type AnimatorFrame, type RigMotion } from './animator';
import { type Mat, invert, localMatrix, multiply } from './rig';
import type { RigScene } from './scene';
import type { Pose } from './skin';
import { WobbleMixer } from './wobble';

/** Ponto por onde ela é segurada ao ser arrastada (fração da altura) */
const GRIP_Y = 0.04;

export interface PreviewInput {
  pose: string;
  expression: string;
  talking?: boolean;
  motion?: RigMotion;
  dir?: 1 | -1;
  gaze?: [number, number] | null;
  reducedMotion?: boolean;
  /** Sem movimento do corpo inteiro (respirar/quicar), pra editar com a figura parada */
  still?: boolean;
  /** Mostra pivôs e caixas das camadas */
  debug?: boolean;
  /** Lado pra onde a skin olha andando (skin.json "facing") */
  facing?: 'left' | 'right';
  /** Tamanho da skin na tela (skin.json "size"): o movimento do corpo é medido nele */
  size?: number;
  /** Força variantes por camada por cima do animador (ex.: mostrar a piscada) */
  variants?: Record<string, string>;
}

export class RigPreview {
  private animator: RigAnimator;
  private readonly wobble = new WobbleMixer();
  /** px do canvas → px do rig, do último quadro (pra clicar e arrastar na prévia) */
  inverseRoot: Mat | null = null;
  root: Mat | null = null;
  lastFrame: AnimatorFrame | null = null;

  constructor(readonly scene: RigScene, random: () => number = Math.random, now = 0) {
    this.animator = new RigAnimator(scene.rig, random, now);
  }

  /** Recomeça as transições (ex.: o rig foi editado) */
  reset(random: () => number = Math.random, now = 0): void {
    this.animator = new RigAnimator(this.scene.rig, random, now);
  }

  /**
   * Desenha um quadro ocupando o canvas inteiro (o canvas do rig é quadrado).
   * @param zoom 1 = o rig inteiro cabe no canvas
   * @param pan deslocamento em px do canvas
   */
  draw(ctx: CanvasRenderingContext2D, now: number, input: PreviewInput, zoom = 1, pan: [number, number] = [0, 0]): void {
    const rig = this.scene.rig;
    const canvas = ctx.canvas;
    const pose = input.motion === 'walk' ? 'walk' : input.motion === 'drag' ? 'drag' : input.pose;
    const dir = input.dir ?? 1;
    const facing = input.facing === 'left' ? -1 : 1;
    const flip = input.motion === 'walk' && dir !== facing ? -1 : 1;

    let body: Mat = [1, 0, 0, 1, 0, 0];
    if (!input.still) {
      this.wobble.set(pose as Pose, now);
      const wob = this.wobble.get(now, dir, !!input.reducedMotion);
      // o wobble é em px de tela; aqui a conta é em px do rig
      const toRig = rig.canvas / (input.size ?? 260);
      const pivot: [number, number] = [rig.feet[0], pose === 'drag' ? rig.canvas * GRIP_Y : rig.feet[1]];
      body = localMatrix([pivot[0] + wob.dx * toRig, pivot[1] + wob.dy * toRig], wob.rot, wob.sx * flip, wob.sy, pivot);
    } else if (flip === -1) {
      body = localMatrix([rig.feet[0], rig.feet[1]], 0, -1, 1, [rig.feet[0], rig.feet[1]]);
    }
    const side = Math.min(canvas.width, canvas.height);
    const s = (side / rig.canvas) * zoom;
    const ox = (canvas.width - rig.canvas * s) / 2 + pan[0];
    const oy = (canvas.height - rig.canvas * s) / 2 + pan[1];
    const root = multiply([s, 0, 0, s, ox, oy], body);
    this.root = root;
    this.inverseRoot = invert(root);

    const frame = this.animator.frame(now, {
      pose,
      expression: input.expression,
      talking: !!input.talking,
      motion: input.motion ?? null,
      dir,
      gaze: input.gaze ?? null,
      drive: 0,
      reducedMotion: !!input.reducedMotion || !!input.still,
    });
    if (input.variants) Object.assign(frame.variants, input.variants);
    this.lastFrame = frame;
    this.scene.draw(ctx, root, frame.offsets, frame, !!input.debug);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
}
