// Site da Tera. Uma Tera companheira percorre a página (companion.ts) e cada seção mexe
// nela: a demo (guiada pela rolagem) muda o estado, as skins mudam pose, expressão e a
// vista explodida, e assim por diante.
import { CHARACTER_STATES } from '@tera/character/states';
import { Companion } from './companion';
import type { Look } from './tera';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const pick = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)]!;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const stateLook = (id: string): Look & { label: string } => {
  const s = CHARACTER_STATES.find((x) => x.id === id) ?? CHARACTER_STATES[0]!;
  return { pose: s.pose, expression: s.expression, label: s.label };
};
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

const companion = new Companion();
const tera = companion.tera;

// ---------- topo ----------

function hero(): void {
  // aurora segue o mouse (devagar)
  const aurora = document.querySelector<HTMLElement>('.aurora')!;
  let tx = 0;
  let ty = 0;
  let cx = 0;
  let cy = 0;
  window.addEventListener('pointermove', (e) => {
    tx = (e.clientX / innerWidth - 0.5) * 60;
    ty = (e.clientY / innerHeight - 0.5) * 40;
  }, { passive: true });
  const loop = () => {
    cx += (tx - cx) * 0.04;
    cy += (ty - cy) * 0.04;
    aurora.style.translate = `${cx}px ${cy}px`;
    requestAnimationFrame(loop);
  };
  if (!reduced) loop();

  let greeted = false;
  companion.on('hero', {
    enter: (t) => {
      t.setBase({ pose: 'idle', expression: 'neutral' });
      if (!greeted) {
        greeted = true;
        t.react({ pose: 'wave', expression: 'happy' }, 2200);
        t.say('Oi! Eu sou a Tera 👋', 3000);
      }
    },
  });
}

// ---------- demo guiada pela rolagem ----------

interface Step {
  /** Onde começa, em fração da rolagem da seção */
  at: number;
  state: string;
  term?: [string, string][];
  card: string;
  code?: string;
  request?: boolean;
  options?: string[];
  say?: string;
}

const PROMPT = 'arruma o bug do cálculo de juros no checkout';
const STEPS: Step[] = [
  { at: 0, state: 'idle', card: 'Parada' },
  { at: 0.06, state: 'listening', card: 'Lendo seu pedido', say: 'Bora!' },
  { at: 0.16, state: 'reading', term: [['t', '● Read '], ['', 'src/checkout/juros.ts']], card: 'Lendo · juros.ts' },
  { at: 0.27, state: 'searching', term: [['t', '● Grep '], ['', '"calcularJuros"']], card: 'Procurando · calcularJuros' },
  { at: 0.38, state: 'typing', term: [['t', '● Edit '], ['', 'src/checkout/juros.ts']], card: 'Editando · juros.ts' },
  { at: 0.5, state: 'attention', term: [['w', '? Permitir: npm run migrate -- --env=dev']], card: 'Quer rodar um comando', code: 'npm run migrate -- --env=dev', request: true, say: 'Psiu! Preciso de você 👀' },
  { at: 0.62, state: 'terminal', term: [['ok', '✓ permitido'], ['t', '  ● Bash '], ['', 'npm test']], card: 'Rodando comando · npm test' },
  { at: 0.74, state: 'error', term: [['e', '✗ 1 teste falhou: arredondamento']], card: 'Erro no teste', say: 'Ops…' },
  { at: 0.82, state: 'typing', term: [['t', '● Edit '], ['', 'src/checkout/juros.ts']], card: 'Editando · juros.ts' },
  { at: 0.9, state: 'happy', term: [['ok', '✓ 42 testes passando']], card: 'Terminou · 2 arquivos', say: 'Pronto! ✨' },
];

function demo(): void {
  const section = $('demo');
  const out = $('term-out');
  const pill = $('demo-state');
  const bar = $('demo-progress');
  const cardsEl = $('demo-cards');
  const sub = $('demo-sub');
  let current = -1;
  /** Um botão mexeu: a rolagem volta a mandar quando muda de passo */
  let override: Step | null = null;
  const other = { title: 'app-mobile', agent: 'Codex · 3 min', line: 'Pensando' };

  const card = (title: string, agent: string, line: string, opts: { code?: string; request?: boolean; options?: string[]; fresh?: boolean } = {}) => {
    const el = document.createElement('div');
    el.className = `glass card${opts.request ? ' request' : ''}${opts.fresh ? ' fresh' : ''}`;
    const b = document.createElement('b');
    b.textContent = title;
    const small = document.createElement('small');
    small.textContent = agent;
    const l = document.createElement('span');
    l.textContent = line;
    el.append(b, small, l);
    if (opts.code) {
      const c = document.createElement('code');
      c.textContent = opts.code;
      el.append(c);
    }
    for (const [i, o] of (opts.options ?? []).entries()) {
      const c = document.createElement('code');
      c.textContent = `${i + 1}. ${o}`;
      el.append(c);
    }
    return el;
  };

  const render = (step: Step, index: number, progress: number, fresh: boolean) => {
    const look = stateLook(step.state);
    pill.textContent = look.label;
    if (companion.slotName === 'demo') tera.setBase(look);
    if (fresh && step.say && companion.slotName === 'demo') tera.say(step.say);
    // terminal: o pedido digitado (proporcional à rolagem no começo) e as linhas até aqui
    const typed = Math.round(clamp01(progress / 0.06) * PROMPT.length);
    const lines: HTMLElement[] = [];
    const prompt = document.createElement('div');
    prompt.innerHTML = '<span class="p">&gt; </span>';
    prompt.append(PROMPT.slice(0, typed));
    lines.push(prompt);
    for (const s of STEPS.slice(0, index + 1)) {
      if (!s.term) continue;
      const row = document.createElement('div');
      for (const [cls, text] of s.term) {
        const span = document.createElement('span');
        if (cls) span.className = cls;
        span.textContent = text;
        row.append(span);
      }
      lines.push(row);
    }
    const caret = document.createElement('span');
    caret.className = 'caret';
    out.replaceChildren(...lines, caret);
    const main = card('api-pagamentos', 'Claude Code · agora', step.card, { code: step.code, request: step.request, options: step.options, fresh });
    const second = card(other.title, other.agent, other.line);
    cardsEl.replaceChildren(...(step.request ? [main, second] : [main, second]));
    sub.textContent = step.request ? '· 1 esperando' : '· 2 sessões';
    sub.classList.toggle('warn', !!step.request);
  };

  const update = () => {
    const r = section.getBoundingClientRect();
    const total = r.height - innerHeight;
    const p = clamp01(-r.top / (total || 1));
    bar.style.width = `${p * 100}%`;
    let index = 0;
    for (let i = 0; i < STEPS.length; i++) if (p >= STEPS[i]!.at) index = i;
    if (index !== current) {
      override = null;
      render(STEPS[index]!, index, p, current !== -1);
      current = index;
    } else if (!override && index === 0) {
      render(STEPS[0]!, 0, p, false);
    } else if (index <= 1 && !override) {
      render(STEPS[index]!, index, p, false);
    }
  };
  window.addEventListener('scroll', update, { passive: true });
  update();

  companion.on('demo', {
    enter: (t) => {
      const s = override ?? STEPS[Math.max(0, current)]!;
      t.setBase(stateLook(s.state));
    },
  });

  const acts: Record<string, Step> = {
    permission: { at: 0, state: 'attention', term: [['w', '? Permitir: rm -rf build/']], card: 'Quer rodar um comando', code: 'rm -rf build/', request: true, say: 'Psiu! Preciso de você 👀' },
    question: { at: 0, state: 'attention', term: [['w', '? Qual lib pro estado do carrinho?']], card: 'Tem uma pergunta', request: true, options: ['Zustand', 'Redux Toolkit', 'Context do React'], say: 'Tenho uma pergunta!' },
    error: { at: 0, state: 'error', term: [['e', '✗ TypeError: juros is undefined']], card: 'Erro', say: pick(['Eita!', 'Hmm, deu erro.']) },
    done: { at: 0, state: 'happy', term: [['ok', '✓ tudo certo']], card: 'Terminou', say: 'Terminei! ✨' },
  };
  for (const b of document.querySelectorAll<HTMLButtonElement>('.controls button')) {
    b.onclick = () => {
      const step = acts[b.dataset.act!];
      if (!step) return;
      override = step;
      const look = stateLook(step.state);
      pill.textContent = look.label;
      tera.setBase(look);
      if (step.say) tera.say(step.say);
      const row = document.createElement('div');
      for (const [cls, text] of step.term ?? []) {
        const span = document.createElement('span');
        if (cls) span.className = cls;
        span.textContent = text;
        row.append(span);
      }
      out.querySelector('.caret')?.before(row);
      cardsEl.replaceChildren(card('api-pagamentos', 'Claude Code · agora', step.card, { code: step.code, request: step.request, options: step.options, fresh: true }), card(other.title, other.agent, other.line));
      sub.textContent = step.request ? '· 1 esperando' : '· 2 sessões';
      sub.classList.toggle('warn', !!step.request);
    };
  }
}

// ---------- interface ----------

function interfaceSection(): void {
  const stacks = [$('theme-stack'), $('demo-stack')];
  for (const b of document.querySelectorAll<HTMLButtonElement>('.theme-picker button')) {
    b.onclick = () => {
      for (const o of document.querySelectorAll('.theme-picker button')) o.setAttribute('aria-checked', String(o === b));
      for (const s of stacks) s.className = `stack theme-${b.dataset.theme}${s.id === 'theme-stack' ? ' reveal-stack in' : ''}`;
      if (companion.slotName === 'interface') {
        tera.react({ pose: 'happy', expression: 'happy' }, 900);
        tera.say(pick(['Ficou lindo!', 'Gostei desse!', 'Uau ✨']), 1400);
      }
    };
  }
  // os cartões caem um a um, como notificações, quando a seção aparece
  const stack = $('theme-stack');
  new IntersectionObserver(([e]) => { if (e?.isIntersecting) stack.classList.add('in'); }, { threshold: 0.35 }).observe(stack);
  companion.on('interface', {
    enter: (t) => {
      t.setBase({ pose: 'idle', expression: 'neutral' });
      t.say('Clicou em mim? A interface abre aqui em cima 👆', 2800);
    },
  });
}

// ---------- celular ----------

function phone(): void {
  const screen = $('phone-screen');
  const btn = $<HTMLButtonElement>('phone-pair');
  const wrap = $('phone-wrap');
  const device = $('phone');
  // inclina em 3D com o mouse
  if (!reduced) {
    wrap.addEventListener('pointermove', (e) => {
      const r = wrap.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      device.style.transform = `perspective(1000px) rotateY(${x * 16}deg) rotateX(${-y * 12}deg)`;
    });
    wrap.addEventListener('pointerleave', () => { device.style.transform = ''; });
  }
  const el = (tag: string, cls: string, text = '') => {
    const e = document.createElement(tag);
    e.className = cls;
    e.textContent = text;
    return e;
  };
  const fakeQr = () => {
    const qr = el('div', 'qr scanline');
    const finder = (x: number, y: number) => {
      const dx = x < 7 ? x : x >= 14 ? x - 14 : -1;
      const dy = y < 7 ? y : y >= 14 ? y - 14 : -1;
      if (dx < 0 || dy < 0 || (x >= 14 && y >= 14)) return null;
      return dx === 0 || dx === 6 || dy === 0 || dy === 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4);
    };
    for (let y = 0; y < 21; y++) for (let x = 0; x < 21; x++) qr.append(document.createElement((finder(x, y) ?? Math.random() > 0.55) ? 'i' : 'b'));
    return qr;
  };
  const idle = () => {
    const c = el('div', 'center');
    c.append(fakeQr(), el('span', '', 'Abra a câmera e leia o QR da Tera no PC'));
    screen.replaceChildren(c);
  };
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    btn.textContent = 'Pareando…';
    const c = el('div', 'center');
    c.append(fakeQr(), el('span', '', 'Lendo o QR code…'));
    screen.replaceChildren(c);
    await wait(1400);
    const c2 = el('div', 'center');
    c2.append(el('strong', '', 'Confirme no PC'), el('span', '', 'A Tera pergunta se pode conectar "Pixel".'));
    screen.replaceChildren(c2);
    if (companion.slotName === 'celular') tera.say('Conectar o "Pixel"? Pode! ✅', 1800);
    await wait(1500);
    const head = el('div', 'phead');
    head.append(el('span', '', '🟡 Tera'), el('small', '', '· meu-pc · ao vivo'));
    screen.replaceChildren(head);
    const items: [string, string, boolean][] = [
      ['api-pagamentos · Claude Code', 'Quer rodar: npm run migrate', true],
      ['teracota · Claude Code', 'Editando · app.ts', false],
      ['app-mobile · Codex', 'Pensando', false],
      ['🍅 Pomodoro', 'Foco · 18:42', false],
    ];
    for (const [t, l, req] of items) {
      const card = el('div', req ? 'pcard req' : 'pcard');
      card.append(el('strong', '', t), el('small', '', l));
      screen.append(card);
      if (req) device.classList.add('buzz');
      await wait(280);
      device.classList.remove('buzz');
    }
    btn.textContent = 'Simular de novo';
    running = false;
  };
  btn.onclick = () => void run();
  idle();
  companion.on('celular', {
    enter: (t) => {
      t.setBase({ pose: 'idle', expression: 'happy' });
      t.lookAt(device.getBoundingClientRect().left, device.getBoundingClientRect().top + 200);
      if (!running && !screen.querySelector('.pcard')) void run();
    },
  });
}

// ---------- skins (a Tera vira o modelo) ----------

function skins(): void {
  let look: Look = { pose: 'idle', expression: 'neutral' };
  const label = $('skin-label');
  const explode = $<HTMLInputElement>('explode');
  const pivots = $<HTMLInputElement>('pivots');
  const apply = () => {
    if (companion.slotName !== 'skins') return;
    tera.setBase(look);
    tera.explode = Number(explode.value) * 0.9;
    tera.debug = pivots.checked;
    label.textContent = `${look.pose} · ${look.expression}`;
  };
  const chips = (boxId: string, items: string[], key: keyof Look) => {
    const box = $(boxId);
    box.replaceChildren(...items.map((name) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = name;
      b.setAttribute('aria-pressed', String(look[key] === name));
      b.onclick = () => {
        look = { ...look, [key]: name };
        for (const o of box.children) o.setAttribute('aria-pressed', String(o === b));
        apply();
      };
      return b;
    }));
  };
  explode.oninput = apply;
  pivots.onchange = apply;
  void companion.start().then(() => {
    const rig = tera.rig!;
    chips('pose-chips', Object.keys(rig.poses), 'pose');
    chips('expr-chips', ['neutral', ...Object.keys(rig.expressions).filter((e) => e !== 'neutral')], 'expression');
  });
  companion.on('skins', {
    enter: (t) => {
      apply();
      t.say('Arrasta a vista explodida pra ver por dentro 👀', 2600);
    },
  });
}

// ---------- plugins e fim ----------

function plugins(): void {
  const total = 25 * 60;
  let left = total;
  const title = $('pomo-title');
  const bar = $('pomo-bar');
  setInterval(() => {
    left = left <= 0 ? total : left - 20;
    title.textContent = `Foco · ${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`;
    bar.style.width = `${((total - left) / total) * 100}%`;
  }, 250);
  companion.on('plugins', { enter: (t) => { t.setBase({ pose: 'work', expression: 'focused' }); t.say('Foco total 🍅', 1800); } });
  companion.on('fim', { enter: (t) => { t.setBase({ pose: 'wave', expression: 'happy' }); t.say('Te vejo no desktop! 💛', 3000); } });
}

// ---------- entrada das seções ----------

function reveal(): void {
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) e.target.classList.add('in');
  }, { threshold: 0.12 });
  for (const s of document.querySelectorAll('.section')) {
    s.classList.add('reveal');
    io.observe(s);
  }
  // título: palavra por palavra
  document.querySelectorAll<HTMLElement>('.kinetic > span, .kinetic em > span').forEach((w, i) => {
    w.style.setProperty('--i', String(i));
  });
  requestAnimationFrame(() => document.body.classList.add('ready'));
}

reveal();
hero();
demo();
interfaceSection();
phone();
plugins();
skins();
