// Personagem desenhado em SVG — usado quando não há skin de sprites.
import type { Point } from '../shared/ipc';
import type { Anim, Expression } from '../shared/protocol';
import type { Character, Motion } from './character';
import type { Look } from './look';

const EYES: Record<Expression, string> = {
  neutral: `
    <ellipse cx="78" cy="102" rx="7" ry="10" fill="var(--ink)"/>
    <ellipse cx="122" cy="102" rx="7" ry="10" fill="var(--ink)"/>
    <circle cx="80" cy="98" r="2.5" fill="#fff"/><circle cx="124" cy="98" r="2.5" fill="#fff"/>`,
  happy: `
    <path d="M69 105 Q78 93 87 105" stroke="var(--ink)" stroke-width="4" fill="none" stroke-linecap="round"/>
    <path d="M113 105 Q122 93 131 105" stroke="var(--ink)" stroke-width="4" fill="none" stroke-linecap="round"/>`,
  focused: `
    <path d="M68 90 L88 94" stroke="var(--ink)" stroke-width="3" stroke-linecap="round"/>
    <path d="M132 90 L112 94" stroke="var(--ink)" stroke-width="3" stroke-linecap="round"/>
    <ellipse cx="78" cy="103" rx="7" ry="6" fill="var(--ink)"/>
    <ellipse cx="122" cy="103" rx="7" ry="6" fill="var(--ink)"/>
    <circle cx="80" cy="101" r="2" fill="#fff"/><circle cx="124" cy="101" r="2" fill="#fff"/>`,
  confused: `
    <path d="M71 95 L85 102 L71 109" stroke="var(--ink)" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M129 95 L115 102 L129 109" stroke="var(--ink)" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  surprised: `
    <circle cx="78" cy="101" r="10" fill="#fff" stroke="var(--ink)" stroke-width="3"/>
    <circle cx="122" cy="101" r="10" fill="#fff" stroke="var(--ink)" stroke-width="3"/>
    <circle cx="78" cy="101" r="4" fill="var(--ink)"/><circle cx="122" cy="101" r="4" fill="var(--ink)"/>`,
  sleepy: `
    <path d="M69 103 Q78 108 87 103" stroke="var(--ink)" stroke-width="4" fill="none" stroke-linecap="round"/>
    <path d="M113 103 Q122 108 131 103" stroke="var(--ink)" stroke-width="4" fill="none" stroke-linecap="round"/>`,
  sad: `
    <path d="M68 92 L86 87" stroke="var(--ink)" stroke-width="3" stroke-linecap="round"/>
    <path d="M132 92 L114 87" stroke="var(--ink)" stroke-width="3" stroke-linecap="round"/>
    <ellipse cx="78" cy="103" rx="6" ry="8" fill="var(--ink)"/>
    <ellipse cx="122" cy="103" rx="6" ry="8" fill="var(--ink)"/>
    <circle cx="80" cy="100" r="2" fill="#fff"/><circle cx="124" cy="100" r="2" fill="#fff"/>`,
};

const MOUTH: Record<Expression, string> = {
  neutral:   `<path d="M92 126 Q100 131 108 126" stroke="var(--ink)" stroke-width="3" fill="none" stroke-linecap="round"/>`,
  happy:     `<path d="M88 122 Q100 140 112 122 Z" fill="var(--ink)"/><path d="M94 131 Q100 135 106 131" fill="#ff7a85"/>`,
  focused:   `<path d="M95 128 L105 128" stroke="var(--ink)" stroke-width="3" stroke-linecap="round"/>`,
  confused:  `<path d="M88 128 Q94 122 100 128 Q106 134 112 128" stroke="var(--ink)" stroke-width="3" fill="none" stroke-linecap="round"/>`,
  surprised: `<ellipse cx="100" cy="129" rx="6" ry="8" fill="var(--ink)"/>`,
  sleepy:    `<ellipse cx="100" cy="129" rx="4" ry="3" fill="var(--ink)"/>`,
  sad:       `<path d="M90 131 Q100 122 110 131" stroke="var(--ink)" stroke-width="3" fill="none" stroke-linecap="round"/>`,
};

const SVG = `
<svg viewBox="0 0 200 220" xmlns="http://www.w3.org/2000/svg">
  <ellipse cx="100" cy="216" rx="52" ry="6" fill="rgba(0,0,0,.18)"/>
  <!-- pés -->
  <ellipse class="foot foot-l" cx="84" cy="212" rx="12" ry="7" fill="var(--hair-dark)" stroke="var(--ink)" stroke-width="2.5"/>
  <ellipse class="foot foot-r" cx="116" cy="212" rx="12" ry="7" fill="var(--hair-dark)" stroke="var(--ink)" stroke-width="2.5"/>
  <!-- corpo -->
  <path d="M58 208 Q56 160 100 156 Q144 160 142 208 Z" fill="var(--hair)" stroke="var(--ink)" stroke-width="3"/>
  <path d="M86 160 L100 176 L114 160" fill="#fff" stroke="var(--ink)" stroke-width="2.5" stroke-linejoin="round"/>
  <!-- orelhas -->
  <path d="M52 70 L46 22 L86 48 Z" fill="var(--hair)" stroke="var(--ink)" stroke-width="3" stroke-linejoin="round"/>
  <path d="M148 70 L154 22 L114 48 Z" fill="var(--hair)" stroke="var(--ink)" stroke-width="3" stroke-linejoin="round"/>
  <path d="M56 58 L53 34 L74 48 Z" fill="var(--blush)"/>
  <path d="M144 58 L147 34 L126 48 Z" fill="var(--blush)"/>
  <!-- cabeça -->
  <circle cx="100" cy="100" r="62" fill="var(--skin)" stroke="var(--ink)" stroke-width="3"/>
  <!-- franja -->
  <path d="M40 94 Q42 42 100 38 Q158 42 160 94 Q146 70 128 66 Q124 80 110 82 Q112 70 100 64 Q90 80 72 80 Q76 70 70 66 Q52 72 40 94 Z"
        fill="var(--hair)" stroke="var(--ink)" stroke-width="3" stroke-linejoin="round"/>
  <!-- bochechas -->
  <ellipse cx="66" cy="120" rx="9" ry="5" fill="var(--blush)" opacity=".7"/>
  <ellipse cx="134" cy="120" rx="9" ry="5" fill="var(--blush)" opacity=".7"/>
  <g class="gaze"><g class="eyes"></g></g>
  <g class="mouth"></g>
  <text class="prop" x="170" y="60" text-anchor="middle"></text>
</svg>`;

/** Centro dos olhos no viewBox (200x220) */
const EYE_CENTER = { x: 100 / 200, y: 102 / 220 };
const GAZE_MAX = { x: 3.5, y: 2.5 };

export class SvgCharacter implements Character {
  private readonly gaze: SVGGElement;
  private readonly eyes: SVGGElement;
  private readonly mouth: SVGGElement;
  private readonly prop: SVGTextElement;
  /** Wrapper (#walker) que recebe as animações de andar/arrastar */
  private readonly wrapper: HTMLElement;
  private expression: Expression = 'neutral';
  private anim: Anim | null = null;
  private look: Look = { pose: 'idle', expression: 'neutral', anim: null };
  private motion: Motion = null;

  constructor(readonly root: HTMLElement) {
    root.innerHTML = SVG;
    root.classList.add('svg-character');
    this.wrapper = root.parentElement ?? root;
    this.gaze = root.querySelector('.gaze')!;
    this.eyes = root.querySelector('.eyes')!;
    this.mouth = root.querySelector('.mouth')!;
    this.prop = root.querySelector('.prop')!;
    this.setExpression('neutral');
    this.startBlinking();
  }

  show(look: Look): void {
    this.look = look;
    if (this.motion !== 'drag') this.setExpression(look.expression);
    this.setAnim(this.motion ? null : look.anim);
  }

  setMotion(motion: Motion, dir: 1 | -1): void {
    this.motion = motion;
    this.wrapper.classList.toggle('walking', motion === 'walk');
    this.wrapper.classList.toggle('dragged', motion === 'drag');
    this.wrapper.style.setProperty('--dir', String(dir));
    if (motion !== 'drag') this.wrapper.style.transform = '';
    if (motion === 'drag') this.setExpression('surprised');
    this.glance(motion === 'walk' ? dir * 0.8 : 0, 0); // olha pra onde está indo
    this.show(this.look);
  }

  setTalking(): void {
    // o desenho não tem boca animada
  }

  setSwing(angle: number): void {
    // girar no sentido horário (positivo no CSS) leva os pés pra esquerda
    this.wrapper.style.transform = this.motion === 'drag' ? `rotate(${(-angle).toFixed(2)}deg)` : '';
  }

  setProp(text: string): void {
    this.prop.textContent = text;
  }

  hitTest(x: number, y: number): boolean {
    const r = this.root.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }

  lookAt(p: Point | null): void {
    if (this.motion) return;
    if (!p) {
      this.glance(0, 0);
      return;
    }
    const r = this.root.getBoundingClientRect();
    const dx = p.x - (r.left + r.width * EYE_CENTER.x);
    const dy = p.y - (r.top + r.height * EYE_CENTER.y);
    const dist = Math.hypot(dx, dy) || 1;
    const strength = Math.min(1, dist / 150); // perto do rosto, olha menos pro lado
    this.glance((dx / dist) * strength, (dy / dist) * strength);
  }

  private glance(dx: number, dy: number): void {
    this.gaze.setAttribute('transform', `translate(${(dx * GAZE_MAX.x).toFixed(2)} ${(dy * GAZE_MAX.y).toFixed(2)})`);
  }

  private setExpression(name: Expression): void {
    this.expression = name;
    this.eyes.innerHTML = EYES[name];
    this.mouth.innerHTML = MOUTH[name];
  }

  private setAnim(name: Anim | null): void {
    if (this.anim) this.root.classList.remove(`anim-${this.anim}`);
    this.anim = name;
    if (!name) return;
    void this.root.offsetWidth; // reinicia a animação se for a mesma
    this.root.classList.add(`anim-${name}`);
  }

  private startBlinking(): void {
    const blink = () => {
      if (this.expression === 'neutral' || this.expression === 'focused') {
        this.eyes.innerHTML = EYES.sleepy;
        window.setTimeout(() => { this.eyes.innerHTML = EYES[this.expression]; }, 120);
      }
      window.setTimeout(blink, 2500 + Math.random() * 3000);
    };
    window.setTimeout(blink, 2000);
  }
}
