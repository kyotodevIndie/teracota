// A Tera de verdade no navegador: o mesmo motor do app (@tera/character) desenhando o rig
// num canvas, com olhar pro mouse, fala em balão, reações e arrasto com balanço.
import { Pendulum } from '@tera/character/pendulum';
import { RigPreview, type PreviewInput } from '@tera/character/preview';
import { type RigManifest, apply, parseRigManifest } from '@tera/character/rig';
import { RigScene } from '@tera/character/scene';

const RIG_URL = new URL('tera/rig/', document.baseURI).href;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

let rigPromise: Promise<RigManifest> | null = null;

/** rig.json validado (uma vez só pra página toda) */
export function loadRig(): Promise<RigManifest> {
  rigPromise ??= fetch(`${RIG_URL}rig.json`).then((r) => r.json()).then((raw) => {
    const parsed = parseRigManifest(raw);
    if (!parsed.rig) throw new Error(parsed.errors.join('; '));
    return parsed.rig;
  });
  return rigPromise;
}

export interface Look {
  pose: string;
  expression: string;
}

export class LiveTera {
  private preview: RigPreview | null = null;
  private scene: RigScene | null = null;
  private base: Look = { pose: 'idle', expression: 'neutral' };
  private look: Look = { ...this.base };
  private lookUntil = 0;
  private bubbleTimer: number | undefined;
  private talkingUntil = 0;
  private gaze: [number, number] | null = null;
  motion: PreviewInput['motion'] = null;
  readonly pendulum = new Pendulum();
  /** Lado que ela vira quando anda */
  dir: 1 | -1 = 1;
  zoom = 1;
  /** Vista explodida (0-1) e pivôs à mostra (seção de skins) */
  explode = 0;
  debug = false;
  private visible = true;

  /** Lugar onde ela vai falar: o balão fica por conta de quem usa */
  onSay?: (text: string) => void;

  constructor(readonly canvas: HTMLCanvasElement, private readonly bubble: HTMLElement | null = null, opts: { zoom?: number } = {}) {
    this.zoom = opts.zoom ?? 1;
    // fora da tela não desenha (economiza bateria)
    new IntersectionObserver(([e]) => { this.visible = !!e?.isIntersecting; }).observe(canvas);
  }

  async start(): Promise<void> {
    const rig = await loadRig();
    this.resize();
    // as imagens são reduzidas pro tamanho em que vão aparecer
    const scale = Math.min(1, (Math.max(this.canvas.width, this.canvas.height) * this.zoom) / rig.canvas);
    this.scene = await RigScene.load(rig, RIG_URL, scale);
    this.preview = new RigPreview(this.scene, Math.random, performance.now());
    new ResizeObserver(() => this.resize()).observe(this.canvas);
    const loop = (now: number) => {
      if (this.visible) this.draw(now);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  get rig(): RigManifest | null {
    return this.scene?.rig ?? null;
  }

  private resize(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(this.canvas.clientWidth * dpr);
    const h = Math.round(this.canvas.clientHeight * dpr);
    if (w && h && (this.canvas.width !== w || this.canvas.height !== h)) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  /** Visual de base (volta pra ele depois das reações) */
  setBase(look: Look): void {
    this.base = look;
    if (performance.now() >= this.lookUntil) this.look = { ...look };
  }

  /** Reação passageira */
  react(look: Look, ms = 1800): void {
    this.look = look;
    this.lookUntil = performance.now() + ms;
  }

  say(text: string, ms = 2600): void {
    this.onSay?.(text);
    if (!this.bubble) return;
    this.bubble.textContent = text;
    this.bubble.hidden = false;
    // recria a animação de entrada
    this.bubble.style.animation = 'none';
    void this.bubble.offsetWidth;
    this.bubble.style.animation = '';
    this.talkingUntil = performance.now() + Math.min(1600, text.length * 55);
    clearTimeout(this.bubbleTimer);
    this.bubbleTimer = window.setTimeout(() => { if (this.bubble) this.bubble.hidden = true; }, ms);
  }

  /** Olha pro ponto (coordenadas da página); null = pra frente */
  lookAt(x: number | null, y = 0): void {
    if (x === null) {
      this.gaze = null;
      return;
    }
    const r = this.canvas.getBoundingClientRect();
    const hx = r.left + r.width / 2;
    const hy = r.top + r.height * 0.36;
    const reach = Math.max(260, r.width);
    this.gaze = [(x - hx) / reach, (y - hy) / reach];
  }

  /** O ponto (página) está em cima da figura? */
  hit(x: number, y: number): boolean {
    if (!this.preview?.inverseRoot || !this.scene) return false;
    const r = this.canvas.getBoundingClientRect();
    const cx = ((x - r.left) / r.width) * this.canvas.width;
    const cy = ((y - r.top) / r.height) * this.canvas.height;
    const [rx, ry] = apply(this.preview.inverseRoot, cx, cy);
    return this.scene.hit(rx, ry) !== null;
  }

  private draw(now: number): void {
    if (!this.preview) return;
    if (now >= this.lookUntil) this.look = { ...this.base };
    const ctx = this.canvas.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const swing = this.motion === 'drag' ? this.pendulum.step(now) : 0;
    this.preview.draw(ctx, now, {
      pose: this.look.pose,
      expression: this.look.expression,
      talking: now < this.talkingUntil,
      motion: this.motion,
      dir: this.dir,
      gaze: this.motion === 'walk' ? null : this.gaze,
      swing,
      explode: this.explode,
      debug: this.debug,
      reducedMotion: reduced,
    }, this.zoom);
  }
}
