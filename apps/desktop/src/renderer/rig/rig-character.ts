// Personagem de rig 2D (o renderer padrão): camadas articuladas em Canvas 2D.
// Implementa a mesma interface `Character` das sprites e do SVG, então o resto do app
// (estados, passeio, arrastar, balão, clique) não muda.
//
// O RigAnimator (@tera/character/animator) decide, a cada quadro, o ajuste e a variante
// de cada camada (pose com transição suave, expressão, piscada, boca, olhar, passos);
// aqui fica só o que depende do DOM: o canvas, o movimento do corpo inteiro (wobble.ts +
// pêndulo do arrasto) e o teste de clique.
import type { Point } from '../../shared/ipc';
import { RigAnimator, type RigMotion } from '@tera/character/animator';
import { type Mat, apply, invert, localMatrix, multiply } from '@tera/character/rig';
import { RigScene } from '@tera/character/scene';
import type { Pose, SkinInfo } from '@tera/character/skin';
import type { Character, Motion } from '../character';
import type { Look } from '../look';
import { IDLE_FPS, MOTION_FPS } from '../frame-clock';
import { WobbleMixer } from '@tera/character/wobble';

/** Ponto por onde ela é segurada ao ser arrastada (fração da altura), igual às sprites */
const GRIP_Y = 0.04;
/** Quanto tempo a pose de aterrissagem dura depois de soltar */
const LAND_MS = 380;
/** Distância (px de tela) em que o olhar chega ao máximo */
const GAZE_REACH = 360;
/**
 * O canvas é maior que a caixa da personagem (centrado nela): balançando no arrasto ou
 * numa pose larga, as partes que saem da caixa continuam aparecendo em vez de cortadas.
 */
const OVERSCAN = 1.8;

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
  private readonly animator: RigAnimator;
  private readonly wobble = new WobbleMixer();
  private look: Look = { pose: 'idle', expression: 'neutral', anim: null };
  private motion: Motion = null;
  private dir: 1 | -1 = 1;
  private swing = 0;
  private lastSwing = 0;
  private talking = false;
  private reduced = false;
  private gaze: [number, number] | null = null;
  private landUntil = 0;
  /** px do canvas → px do rig, da última pose desenhada (pro hitTest) */
  private inverseRoot: Mat | null = null;
  debug = false;
  private readonly stat = { frames: 0, total: 0, max: 0 };

  /** Carrega e valida tudo (todas as variantes) antes do primeiro quadro; rejeita se alguma camada falhar */
  static async create(root: HTMLElement, skin: SkinInfo): Promise<RigCharacter> {
    if (!skin.rig) throw new Error(`skin "${skin.id}" não é um rig`);
    const size = skin.manifest.size;
    const dpr = window.devicePixelRatio || 1;
    const scene = await RigScene.load(skin.rig, skin.baseUrl, (size * dpr) / skin.rig.canvas);
    const character = new RigCharacter(root, skin, scene);
    character.tick(performance.now());
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
    const side = size * OVERSCAN;
    Object.assign(this.canvas.style, {
      position: 'absolute', width: `${side}px`, height: `${side}px`,
      left: `${-(side - size) / 2}px`, top: `${-(side - size) / 2}px`, pointerEvents: 'none',
    });
    root.style.overflow = 'visible';
    this.canvas.width = this.canvas.height = Math.round(side * dpr);
    this.ctx = this.canvas.getContext('2d')!;
    this.animator = new RigAnimator(scene.rig, Math.random, performance.now());
  }

  show(look: Look): void {
    this.look = look;
  }

  setMotion(motion: Motion, dir: 1 | -1): void {
    if (this.motion === 'drag' && motion === null) this.landUntil = performance.now() + LAND_MS;
    if (motion) this.landUntil = 0; // pegou de novo no meio da aterrissagem
    if (motion === 'walk') this.gaze = null; // andando olha pra frente
    this.motion = motion;
    this.dir = dir;
  }

  setTalking(talking: boolean): void {
    this.talking = talking;
  }

  setSwing(angle: number): void {
    this.swing = angle;
  }

  setProp(text: string): void {
    this.propEl.textContent = text;
  }

  setReducedMotion(reduced: boolean): void {
    this.reduced = reduced;
  }

  /** Olha pro cursor: direção a partir da cabeça, normalizada pela distância */
  lookAt(p: Point | null): void {
    if (!p) {
      this.gaze = null;
      return;
    }
    const r = this.root.getBoundingClientRect();
    const head = { x: r.left + r.width / 2, y: r.top + r.height * 0.32 };
    this.gaze = [(p.x - head.x) / GAZE_REACH, (p.y - head.y) / GAZE_REACH];
  }

  /** Clique só onde há pixel opaco de alguma camada visível, já com rotação/escala/pivô aplicados */
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

  /** Mesmo critério das sprites: fluido em movimento, econômico parada */
  targetFps(): number {
    if (this.motion || performance.now() < this.landUntil) return MOTION_FPS;
    if (this.reduced) return 12; // piscada e boca ainda precisam de quadros
    if (this.look.pose === 'sleep') return 15;
    return IDLE_FPS;
  }

  // ---------- desenho ----------

  private currentPose(now: number): Pose {
    if (this.motion === 'walk') return 'walk';
    if (this.motion === 'drag') return 'drag';
    if (now < this.landUntil) return 'land';
    return this.look.pose;
  }

  /** Desenha um quadro (o relógio da janela chama; a inspeção chama direto pra medir) */
  tick(now: number): void {
    const t0 = performance.now();
    const rig = this.scene.rig;
    const pose = this.currentPose(now);

    // corpo inteiro: movimento procedural em px do rig, ancorado nos pés (ou na pega ao arrastar)
    this.wobble.set(pose, now);
    const wob = this.wobble.get(now, this.dir, this.reduced);
    // o balanço do arrasto vem da física (positivo = pés pra direita → horário negativo)
    if (this.motion === 'drag' && !this.reduced) wob.rot -= this.swing;
    const facing = this.skin.manifest.facing === 'right' ? 1 : -1;
    const flip = this.motion === 'walk' && this.dir !== facing ? -1 : 1;
    const toRig = rig.canvas / this.skin.manifest.size; // px de tela → px do rig
    const pivot: [number, number] = [rig.feet[0], pose === 'drag' ? rig.canvas * GRIP_Y : rig.feet[1]];
    const body = localMatrix([pivot[0] + wob.dx * toRig, pivot[1] + wob.dy * toRig], wob.rot, wob.sx * flip, wob.sy, pivot);
    // o rig ocupa a caixa da personagem, no meio do canvas maior
    const s = this.canvas.width / (rig.canvas * OVERSCAN);
    const off = (this.canvas.width - rig.canvas * s) / 2;
    const root = multiply([s, 0, 0, s, off, off], body);
    this.inverseRoot = invert(root);

    // a cauda "fica pra trás" quando o corpo balança
    const swingVelocity = this.swing - this.lastSwing;
    this.lastSwing = this.swing;
    const frame = this.animator.frame(now, {
      pose,
      expression: this.look.expression,
      talking: this.talking,
      motion: this.motion as RigMotion,
      dir: this.dir,
      // virada pra esquerda, o "pra frente" do olhar inverte junto com o desenho
      gaze: this.gaze && [this.gaze[0] * flip, this.gaze[1]],
      drive: this.motion === 'drag' ? swingVelocity * 6 : 0,
      reducedMotion: this.reduced,
    });

    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.scene.draw(ctx, root, frame.offsets, frame, this.debug);

    const ms = performance.now() - t0;
    this.stat.frames++;
    this.stat.total += ms;
    this.stat.max = Math.max(this.stat.max, ms);
  }
}
