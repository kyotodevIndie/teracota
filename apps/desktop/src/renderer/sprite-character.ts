// Personagem feito de sprites (skin). Desenha os frames num <canvas> e troca de
// animação conforme o visual pedido, o movimento (andar/arrastar) e a fala.
// Os frames trocam no tempo da skin; o desenho segue o relógio da janela pra aplicar o
// movimento procedural (wobble.ts) por cima. É o fallback do rig.
import type { Point } from '../shared/ipc';
import { HIT_MASK_SIZE, type Pose, type SkinInfo, type SkinSwing } from '@tera/character/skin';
import type { Character, Motion } from './character';
import type { Look } from './look';
import { IDLE_FPS, MOTION_FPS } from './frame-clock';
import { FEET_Y, WobbleMixer } from './wobble';

/** Se a skin não tiver a pose, usa esta no lugar */
const FALLBACK: Record<Pose, Pose> = {
  idle: 'idle', walk: 'idle', drag: 'surprised', land: 'idle', work: 'think', think: 'idle',
  talk: 'idle', happy: 'wave', error: 'surprised', sad: 'idle', sleep: 'idle', wave: 'happy', surprised: 'idle',
};
/** Alfa mínimo pra considerar que o mouse está em cima do personagem */
const HIT_ALPHA = 40;

interface Playing {
  pose: Pose;
  flip: boolean;
  frame: number;
  /** Toca uma vez e volta ao visual atual (ex.: aterrissar depois de arrastar) */
  once: boolean;
  startedAt: number;
}

export class SpriteCharacter implements Character {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly propEl: HTMLElement;
  /** Frames já redimensionados pro tamanho do canvas (desenhar 1:1 é bem mais barato) */
  private readonly frames: Partial<Record<Pose, ImageBitmap[]>> = {};
  private look: Look = { pose: 'idle', expression: 'neutral', anim: null };
  private motion: Motion = null;
  private dir: 1 | -1 = 1;
  private talking = false;
  private swing = 0;
  private playing: Playing | null = null;
  private timer: number | undefined;
  private reduced = false;
  private readonly wobble = new WobbleMixer();

  /** Cria e já espera todas as imagens carregarem (evita piscar na primeira troca) */
  static async create(root: HTMLElement, skin: SkinInfo): Promise<SpriteCharacter> {
    const character = new SpriteCharacter(root, skin);
    await character.preload();
    character.refresh();
    return character;
  }

  private constructor(readonly root: HTMLElement, private readonly skin: SkinInfo) {
    const size = skin.manifest.size;
    root.classList.add('sprite-character');
    root.style.width = root.style.height = `${size}px`;
    root.innerHTML = '<canvas></canvas><span class="prop"></span>';
    this.canvas = root.querySelector('canvas')!;
    this.propEl = root.querySelector('.prop')!;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = this.canvas.height = Math.round(size * dpr);
    this.ctx = this.canvas.getContext('2d')!;
  }

  show(look: Look): void {
    this.look = look;
    this.refresh();
  }

  setMotion(motion: Motion, dir: 1 | -1): void {
    const landed = this.motion === 'drag' && motion === null;
    this.motion = motion;
    this.dir = dir;
    if (motion && this.playing?.once) this.playing = null; // pegou de novo no meio da aterrissagem
    if (landed && this.frames.land) this.play('land', false, true);
    else this.refresh();
  }

  setTalking(talking: boolean): void {
    this.talking = talking;
    this.refresh();
  }

  setSwing(angle: number): void {
    this.swing = angle;
  }

  setProp(text: string): void {
    this.propEl.textContent = text;
  }

  lookAt(_p: Point | null): void {
    // sprites não têm olhos independentes
  }

  setReducedMotion(reduced: boolean): void {
    this.reduced = reduced;
  }

  hitTest(x: number, y: number): boolean {
    const r = this.canvas.getBoundingClientRect();
    if (x < r.left || x >= r.right || y < r.top || y >= r.bottom || !this.playing) return false;
    const { pose, frame, flip } = this.playing;
    const mask = this.skin.hitMasks[pose]?.[frame];
    if (!mask) return true;
    // desfaz a escala da animação (ancorada nos pés) pra cair no pixel certo do frame
    const scale = this.skin.manifest.animations[pose]?.scale ?? 1;
    let fx = 0.5 + ((x - r.left) / r.width - 0.5) / scale;
    const fy = FEET_Y + ((y - r.top) / r.height - FEET_Y) / scale;
    if (flip) fx = 1 - fx;
    if (fx < 0 || fx >= 1 || fy < 0 || fy >= 1) return false;
    const i = Math.floor(fy * HIT_MASK_SIZE) * HIT_MASK_SIZE + Math.floor(fx * HIT_MASK_SIZE);
    return (mask[i] ?? 0) > HIT_ALPHA;
  }

  // ---------- animação ----------

  private async preload(): Promise<void> {
    const { baseUrl, manifest } = this.skin;
    await Promise.all(Object.entries(manifest.animations).map(async ([pose, anim]) => {
      this.frames[pose as Pose] = await Promise.all(anim.frames.map(async (src) => {
        const img = new Image();
        img.src = new URL(src, baseUrl).href;
        await img.decode();
        const size = this.canvas.width;
        return createImageBitmap(img, { resizeWidth: size, resizeHeight: size, resizeQuality: 'high' });
      }));
    }));
  }

  /** Pose que deveria estar tocando agora */
  private targetPose(): Pose {
    if (this.motion === 'walk') return 'walk';
    if (this.motion === 'drag') return 'drag';
    if (this.talking && this.look.pose === 'idle') return 'talk';
    return this.look.pose;
  }

  /** Segue os fallbacks até achar uma pose que a skin tem */
  private resolve(pose: Pose): Pose {
    const seen = new Set<Pose>();
    while (!this.frames[pose] && !seen.has(pose)) {
      seen.add(pose);
      pose = FALLBACK[pose];
    }
    return this.frames[pose] ? pose : 'idle';
  }

  private refresh(): void {
    if (this.playing?.once) return; // deixa a animação de uma vez terminar
    const pose = this.resolve(this.targetPose());
    const facing = this.skin.manifest.facing === 'right' ? 1 : -1;
    const flip = pose === 'walk' && this.dir !== facing;
    if (this.playing?.pose === pose && this.playing.flip === flip) return;
    this.play(pose, flip, false);
  }

  private play(pose: Pose, flip: boolean, once: boolean): void {
    window.clearTimeout(this.timer);
    this.playing = { pose, flip, frame: 0, once, startedAt: performance.now() };
    this.scheduleNext();
  }

  /** Avança os frames no tempo definido pela skin */
  private scheduleNext(): void {
    const p = this.playing;
    const anim = p && this.skin.manifest.animations[p.pose];
    if (!p || !anim) return;
    if (anim.swing) return; // o frame vem do balanço, não do tempo
    this.timer = window.setTimeout(() => {
      if (p.frame + 1 < anim.frames.length) {
        p.frame++;
      } else if (p.once) {
        this.playing = null;
        this.refresh();
        return;
      } else if (anim.loop === false) {
        return; // segura o último frame
      } else {
        p.frame = 0;
      }
      this.scheduleNext();
    }, anim.durations[p.frame] ?? 150);
  }

  /** Quadros por segundo do desenho: fluido quando está se movendo, econômico quando parada */
  targetFps(): number {
    if (this.motion) return MOTION_FPS;
    if (this.reduced) return 12;
    if (this.playing?.pose === 'sleep') return 15;
    return IDLE_FPS;
  }

  /** Desenha o frame atual + escala da animação + movimento procedural */
  tick(now: number): void {
    const p = this.playing;
    const anim = p && this.skin.manifest.animations[p.pose];
    if (!p || !anim) return;
    const dragged = this.motion === 'drag';
    // sem mapeamento de frames na skin, o balanço é só rotação (positivo no canvas = pés pra esquerda)
    const swingRot = !dragged || this.reduced ? 0 : anim.swing ? this.applySwing(p, anim.swing) : -this.swing;
    const img = this.frames[p.pose]?.[p.frame];
    if (!img) return;

    const { width: w, height: h } = this.canvas;
    const px = w / this.skin.manifest.size; // px de tela → px do canvas
    const scale = anim.scale ?? 1;
    this.wobble.set(dragged ? 'drag' : p.pose, now);
    const wob = this.wobble.get(now, this.dir, this.reduced);
    wob.rot += swingRot;
    const pivotX = w / 2;
    const pivotY = h * wob.pivotY;
    const ctx = this.ctx;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.translate(pivotX + wob.dx * px, pivotY + wob.dy * px);
    ctx.rotate((wob.rot * Math.PI) / 180);
    ctx.scale(wob.sx * (p.flip ? -1 : 1), wob.sy);
    ctx.translate(-pivotX, -pivotY);
    // escala da animação sempre ancorada nos pés (independe do pivô do movimento)
    const feetY = h * FEET_Y;
    ctx.translate(pivotX, feetY);
    ctx.scale(scale, scale);
    ctx.translate(-pivotX, -feetY);
    ctx.drawImage(img, 0, 0, w, h);
  }

  /**
   * Escolhe o frame pelo balanço (inclinado pra um lado, centro, outro lado) e
   * devolve a rotação que falta pra chegar no ângulo — descontando a inclinação
   * que já vem desenhada no frame. Com histerese pra não ficar piscando na divisa.
   */
  private applySwing(p: Playing, swing: SkinSwing): number {
    const a = this.swing;
    const tilted = p.frame === swing.feetRight || p.frame === swing.feetLeft;
    const threshold = tilted ? swing.lean * 0.6 : swing.lean;
    let drawnLean = 0;
    if (a > threshold) {
      p.frame = swing.feetRight;
      drawnLean = swing.lean;
    } else if (a < -threshold) {
      p.frame = swing.feetLeft;
      drawnLean = -swing.lean;
    } else {
      p.frame = swing.center;
    }
    // positivo no canvas é horário, que leva os pés pra esquerda
    return -(a - drawnLean);
  }
}
