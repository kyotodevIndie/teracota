// Personagem de rig 2D (experimental): camadas articuladas em Canvas 2D.
// Implementa a mesma interface `Character` das sprites e do SVG, então o resto do app
// (estados, passeio, arrastar, balão, clique) não muda.
//
// Nesta etapa: respiração, cauda em cadeia e o movimento do corpo inteiro que as
// sprites já usam (wobble.ts + pêndulo do arrasto). Poses, expressões, piscada e olhar
// ficam pra quando houver arte definitiva — por enquanto todas as poses usam a base.
import type { Point } from '../../shared/ipc';
import { type Mat, apply, invert, localMatrix, multiply } from '@tera/character/rig';
import type { SkinInfo } from '@tera/character/skin';
import type { Character, Motion } from '../character';
import type { Look } from '../look';
import { wobbleFor } from '../wobble';
import { ChainSway, breathe, mergeOffsets } from '@tera/character/controllers';
import { RigScene } from '@tera/character/scene';

/** Ponto por onde ela é segurada ao ser arrastada (fração da altura), igual às sprites */
const GRIP_Y = 0.04;

export interface RigStats {
  frames: number;
  /** média do tempo de desenho por quadro (ms) */
  drawMs: number;
  /** pior quadro (ms) */
  maxDrawMs: number;
}

export class RigCharacter implements Character {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly propEl: HTMLElement;
  private readonly sway: ChainSway | null;
  private look: Look = { pose: 'idle', expression: 'neutral', anim: null };
  private motion: Motion = null;
  private dir: 1 | -1 = 1;
  private swing = 0;
  private lastSwing = 0;
  private poseStartedAt = performance.now();
  /** px do canvas → px do rig, da última pose desenhada (pro hitTest) */
  private inverseRoot: Mat | null = null;
  private lastDraw = 0;
  private running = true;
  debug = false;
  private readonly stat = { frames: 0, total: 0, max: 0 };

  /** Carrega e valida tudo antes do primeiro quadro; rejeita se alguma camada falhar */
  static async create(root: HTMLElement, skin: SkinInfo): Promise<RigCharacter> {
    if (!skin.rig) throw new Error(`skin "${skin.id}" não é um rig`);
    const size = skin.manifest.size;
    const dpr = window.devicePixelRatio || 1;
    const scene = await RigScene.load(skin.rig, skin.baseUrl, (size * dpr) / skin.rig.canvas);
    const character = new RigCharacter(root, skin, scene);
    character.render();
    return character;
  }

  private constructor(readonly root: HTMLElement, private readonly skin: SkinInfo, private readonly scene: RigScene) {
    const size = skin.manifest.size;
    root.classList.add('sprite-character'); // mesmo layout (canvas + ícone) das sprites
    root.style.width = root.style.height = `${size}px`;
    root.innerHTML = '<canvas></canvas><span class="prop"></span>';
    this.canvas = root.querySelector('canvas')!;
    this.propEl = root.querySelector('.prop')!;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = this.canvas.height = Math.round(size * dpr);
    this.ctx = this.canvas.getContext('2d')!;
    this.sway = scene.rig.controllers.sway ? new ChainSway(scene.rig.controllers.sway) : null;
  }

  show(look: Look): void {
    if (look.pose !== this.look.pose) this.poseStartedAt = performance.now();
    this.look = look;
  }

  setMotion(motion: Motion, dir: 1 | -1): void {
    if (motion !== this.motion) this.poseStartedAt = performance.now();
    this.motion = motion;
    this.dir = dir;
  }

  setTalking(_talking: boolean): void {
    // sem boca separada nas camadas provisórias
  }

  setSwing(angle: number): void {
    this.swing = angle;
  }

  setProp(text: string): void {
    this.propEl.textContent = text;
  }

  lookAt(_p: Point | null): void {
    // olhar o cursor fica pra próxima etapa (cabeça + íris)
  }

  /** Clique só onde há pixel opaco de alguma camada, já com rotação/escala/pivô aplicados */
  hitTest(x: number, y: number): boolean {
    if (!this.inverseRoot) return false;
    const r = this.canvas.getBoundingClientRect();
    if (x < r.left || x >= r.right || y < r.top || y >= r.bottom) return false;
    const cx = ((x - r.left) / r.width) * this.canvas.width;
    const cy = ((y - r.top) / r.height) * this.canvas.height;
    const [rx, ry] = apply(this.inverseRoot, cx, cy);
    return this.scene.hit(rx, ry) !== null;
  }

  /** Camada sob o ponto (coordenadas da janela) — usado na página de inspeção */
  layerAt(x: number, y: number): string | null {
    if (!this.inverseRoot) return null;
    const r = this.canvas.getBoundingClientRect();
    const [rx, ry] = apply(this.inverseRoot, ((x - r.left) / r.width) * this.canvas.width, ((y - r.top) / r.height) * this.canvas.height);
    return this.scene.hit(rx, ry);
  }

  stats(): RigStats {
    const { frames, total, max } = this.stat;
    return { frames, drawMs: frames ? total / frames : 0, maxDrawMs: max };
  }

  resetStats(): void {
    this.stat.frames = this.stat.total = this.stat.max = 0;
  }

  destroy(): void {
    this.running = false;
  }

  // ---------- desenho ----------

  private poseForMotion() {
    if (this.motion === 'walk') return 'walk' as const;
    if (this.motion === 'drag') return 'drag' as const;
    return this.look.pose;
  }

  /** Mesmo critério das sprites: fluido em movimento, econômico parada */
  private targetFps(): number {
    if (this.motion) return 60;
    if (this.look.pose === 'sleep') return 15;
    return 24;
  }

  private render = (now: number = performance.now()): void => {
    if (!this.running) return;
    requestAnimationFrame(this.render);
    if (now - this.lastDraw < 1000 / this.targetFps() - 2) return;
    this.lastDraw = now;
    this.drawFrame(now);
  };

  /** Desenha um quadro (o laço chama no ritmo do fps; a inspeção chama direto pra medir) */
  drawFrame(now: number = performance.now()): void {
    const t0 = performance.now();

    const rig = this.scene.rig;
    const pose = this.poseForMotion();
    const wob = wobbleFor(pose, now - this.poseStartedAt, this.dir);
    // o balanço do arrasto vem da física (positivo = pés pra direita → horário negativo)
    if (this.motion === 'drag') wob.rot -= this.swing;
    const facing = this.skin.manifest.facing === 'right' ? 1 : -1;
    const flip = this.motion === 'walk' && this.dir !== facing ? -1 : 1;

    // corpo inteiro: movimento procedural em px do rig, ancorado nos pés (ou na pega ao arrastar)
    const toRig = rig.canvas / this.skin.manifest.size; // px de tela → px do rig
    const pivot: [number, number] = [rig.feet[0], pose === 'drag' ? rig.canvas * GRIP_Y : rig.feet[1]];
    const body = localMatrix([pivot[0] + wob.dx * toRig, pivot[1] + wob.dy * toRig], wob.rot, wob.sx * flip, wob.sy, pivot);
    const s = this.canvas.width / rig.canvas;
    const root = multiply([s, 0, 0, s, 0, 0], body);
    this.inverseRoot = invert(root);

    // a cauda "fica pra trás" quando o corpo balança
    const swingVelocity = this.swing - this.lastSwing;
    this.lastSwing = this.swing;
    const drive = this.motion === 'drag' ? swingVelocity * 6 : this.motion === 'walk' ? -10 * this.dir : 0;
    const offsets = mergeOffsets(
      rig.controllers.breathe ? breathe(rig.controllers.breathe, now) : {},
      this.sway ? this.sway.step(now, drive) : {},
    );

    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.scene.draw(ctx, root, offsets, this.debug);

    const ms = performance.now() - t0;
    this.stat.frames++;
    this.stat.total += ms;
    this.stat.max = Math.max(this.stat.max, ms);
  }
}

