// A Tera companheira: uma só pra página toda. Cada seção tem um lugar pra ela
// (.tera-slot); quando você rola pra outra seção, ela pula até lá (num arco, segurando
// a "cauda" do balanço) e aterrissa. Dá pra pegar e soltar onde quiser: ela cai com
// gravidade e fica ali até você ir pra outra seção. O site é o desktop dela.
import { type Look, LiveTera } from './tera';

/** Tamanho fixo do canvas (px CSS); o tamanho na tela vem de uma escala */
const BASE = 600;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const pick = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)]!;

interface Slot {
  el: HTMLElement;
  name: string;
  size: number;
  section: HTMLElement;
}

type Mode =
  | { kind: 'slot' }
  | { kind: 'flying'; fromX: number; fromY: number; fromS: number; start: number; dur: number }
  | { kind: 'held'; dx: number; dy: number; lastX: number }
  | { kind: 'falling'; vy: number }
  | { kind: 'free' };

export interface SlotHooks {
  /** Chegou na seção (look e fala de chegada) */
  enter?(tera: LiveTera): void;
  leave?(tera: LiveTera): void;
}

export class Companion {
  readonly tera: LiveTera;
  private readonly wrap: HTMLElement;
  private readonly bubble: HTMLElement;
  private slots: Slot[] = [];
  private active: Slot | null = null;
  private mode: Mode = { kind: 'slot' };
  private x = 0;
  private y = 0;
  private s = 300;
  private last = 0;
  private readonly hooks = new Map<string, SlotHooks>();

  constructor() {
    this.wrap = document.getElementById('companion')!;
    this.bubble = document.getElementById('bubble')!;
    const canvas = document.getElementById('tera') as HTMLCanvasElement;
    canvas.style.width = canvas.style.height = `${BASE}px`;
    this.tera = new LiveTera(canvas, this.bubble);
    for (const el of document.querySelectorAll<HTMLElement>('.tera-slot')) {
      this.slots.push({ el, name: el.dataset.slot!, size: Number(el.dataset.size) || 300, section: el.closest('section') as HTMLElement });
    }
  }

  on(slot: string, hooks: SlotHooks): void {
    this.hooks.set(slot, hooks);
  }

  get slotName(): string | null {
    return this.active?.name ?? null;
  }

  async start(): Promise<void> {
    await this.tera.start();
    this.layoutSlots();
    window.addEventListener('resize', () => this.layoutSlots());
    const first = this.pickSlot();
    this.active = first;
    const t = this.target(first);
    [this.x, this.y, this.s] = [t.x, t.y, t.s];
    this.hooks.get(first.name)?.enter?.(this.tera);
    this.input();
    const loop = (now: number) => {
      this.frame(now);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  /** O tamanho de cada lugar acompanha a largura disponível (celular) */
  private layoutSlots(): void {
    for (const sl of this.slots) {
      const avail = sl.el.parentElement?.clientWidth ?? sl.size;
      const size = Math.min(sl.size, Math.max(140, avail * 0.9));
      sl.el.style.width = `${size}px`;
      sl.el.style.height = `${size}px`;
    }
  }

  /** A seção que mais aparece na tela */
  private pickSlot(): Slot {
    const vh = innerHeight;
    let best = this.slots[0]!;
    let bestScore = -1;
    for (const sl of this.slots) {
      const r = sl.section.getBoundingClientRect();
      const visible = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
      const score = visible / Math.min(vh, r.height || 1);
      if (score > bestScore + 0.05) {
        best = sl;
        bestScore = score;
      }
    }
    return best;
  }

  /** Onde ela fica num lugar: pés na base do lugar, centrada */
  private target(sl: Slot): { x: number; y: number; s: number } {
    const r = sl.el.getBoundingClientRect();
    const s = r.width || sl.size;
    return { x: r.left + r.width / 2 - s / 2, y: r.bottom - s, s };
  }

  private frame(now: number): void {
    const dt = this.last ? Math.min(0.05, (now - this.last) / 1000) : 0;
    this.last = now;
    const next = this.pickSlot();
    if (next !== this.active && this.mode.kind !== 'held') this.goTo(next, now);

    const t = this.active ? this.target(this.active) : { x: this.x, y: this.y, s: this.s };
    const m = this.mode;
    if (m.kind === 'slot') {
      [this.x, this.y, this.s] = [t.x, t.y, t.s];
    } else if (m.kind === 'flying') {
      const k = Math.min(1, (now - m.start) / m.dur);
      const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      const px = this.x;
      this.x = m.fromX + (t.x - m.fromX) * e;
      this.y = m.fromY + (t.y - m.fromY) * e - Math.sin(Math.PI * k) * Math.min(260, 80 + Math.abs(t.x - m.fromX) * 0.3);
      this.s = m.fromS + (t.s - m.fromS) * e;
      this.tera.pendulum.push((this.x - px) * 0.6);
      if (k >= 1) this.land();
    } else if (m.kind === 'falling') {
      m.vy += 2600 * dt;
      this.y += m.vy * dt;
      const ground = innerHeight - this.s - 6;
      if (this.y >= ground) {
        this.y = ground;
        this.mode = { kind: 'free' };
        this.tera.motion = null;
        this.tera.react({ pose: 'land', expression: 'surprised' }, 500);
        setTimeout(() => this.tera.say(pick(['Ufa, chão!', 'De novo! De novo!', 'Tô tonta…'])), 400);
      }
    }
    const scale = this.s / BASE;
    this.wrap.style.transform = `translate3d(${this.x}px, ${this.y}px, 0) scale(${scale})`;
    // balão acima da cabeça
    this.bubble.style.transform = `translate3d(${this.x + this.s / 2}px, ${this.y + this.s * 0.08}px, 0) translate(-50%, -100%)`;
  }

  private goTo(slot: Slot, now: number): void {
    const prev = this.active;
    this.active = slot;
    if (prev) this.hooks.get(prev.name)?.leave?.(this.tera);
    this.tera.explode = 0;
    this.tera.debug = false;
    const t = this.target(slot);
    if (reduced) {
      this.mode = { kind: 'slot' };
      this.hooks.get(slot.name)?.enter?.(this.tera);
      return;
    }
    const dist = Math.hypot(t.x - this.x, t.y - this.y);
    this.mode = { kind: 'flying', fromX: this.x, fromY: this.y, fromS: this.s, start: now, dur: Math.min(1100, 420 + dist * 0.6) };
    this.tera.motion = 'drag';
    this.tera.pendulum.reset();
    if (Math.random() < 0.5) this.tera.say(pick(['Weee!', 'Lá vou eu!', 'Hop!', 'Me espera!']), 1200);
  }

  private land(): void {
    this.mode = { kind: 'slot' };
    this.tera.motion = null;
    this.tera.react({ pose: 'land', expression: 'surprised' }, 380);
    if (this.active) setTimeout(() => this.active && this.hooks.get(this.active.name)?.enter?.(this.tera), 380);
  }

  // ---------- pegar, arrastar, soltar, clicar ----------

  private input(): void {
    let down: { x: number; y: number; moved: boolean } | null = null;
    window.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !this.tera.hit(e.clientX, e.clientY)) return;
      e.preventDefault();
      down = { x: e.clientX, y: e.clientY, moved: false };
      this.mode = { kind: 'held', dx: e.clientX - this.x, dy: e.clientY - this.y, lastX: e.clientX };
      document.body.classList.add('grabbing');
    });
    window.addEventListener('pointermove', (e) => {
      this.tera.lookAt(e.clientX, e.clientY);
      const m = this.mode;
      if (m.kind !== 'held' || !down) {
        document.body.classList.toggle('over-tera', this.tera.hit(e.clientX, e.clientY));
        return;
      }
      if (!down.moved && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) {
        down.moved = true;
        this.tera.motion = 'drag';
        this.tera.pendulum.reset();
        this.tera.say(pick(['Uaaa!', 'Ei, me solta!', 'Weeee!', 'Cuidado aí!']));
      }
      if (down.moved) {
        this.tera.pendulum.push(e.clientX - m.lastX);
        m.lastX = e.clientX;
        this.x = e.clientX - m.dx;
        this.y = e.clientY - m.dy;
      }
    }, { passive: true });
    const up = () => {
      if (!down) return;
      const moved = down.moved;
      down = null;
      document.body.classList.remove('grabbing');
      if (moved) {
        this.mode = reduced ? { kind: 'free' } : { kind: 'falling', vy: 0 };
        if (reduced) this.tera.motion = null;
        return;
      }
      // clique: carinho
      this.mode = this.mode.kind === 'held' ? { kind: this.active ? 'slot' : 'free' } : this.mode;
      if (this.mode.kind === 'slot' && this.active && Math.hypot(this.target(this.active).x - this.x, this.target(this.active).y - this.y) > 4) this.mode = { kind: 'free' };
      const r = pick<{ look: Look; say: string }>([
        { look: { pose: 'happy', expression: 'happy' }, say: 'Hehe ✨' },
        { look: { pose: 'wave', expression: 'happy' }, say: 'Oi de novo!' },
        { look: { pose: 'surprised', expression: 'surprised' }, say: 'Opa!' },
        { look: { pose: 'think', expression: 'focused' }, say: 'Hmm… bora codar?' },
      ]);
      this.tera.react(r.look, 1600);
      this.tera.say(r.say);
    };
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }
}
