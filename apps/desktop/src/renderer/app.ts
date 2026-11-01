// Cérebro do personagem: estados vindos do Claude, passeio e interação com o mouse.
import type { Identity, ModeInfo, MotionInfo, Point, WalkInfo, WalkPlan } from '../shared/ipc';
import type { Anim, Expression, StateName, CompanionEvent } from '../shared/protocol';
import type { Pose } from '@tera/character/skin';
import { Bubble } from './bubble';
import type { Character } from './character';
import { FrameClock, MOTION_FPS } from './frame-clock';
import { PointerGesture } from './gesture';
import { poseFor, type Look } from './look';
import { Pendulum } from '@tera/character/pendulum';
import { PetDetector } from './pet';
import { RigCharacter } from './rig/rig-character';
import { SpriteCharacter } from './sprite-character';
import { SLEEP_AFTER, STATE_DEFS, TOOL_STATE_TIMEOUT } from './states';
import { SvgCharacter } from './svg-character';
import { walkStep } from './walk-plan';
import { type Rect, clipRects, padRect } from './shape';

interface Reaction {
  pose?: Pose;
  expression?: Expression;
  anim?: Anim;
  say?: string;
  duration?: number;
}

const pick = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)]!;

const api = window.teracota;
const characterEl = document.getElementById('character')!;
const bubble = new Bubble(
  document.getElementById('bubble')!,
  document.getElementById('bubble-text')!,
  document.getElementById('bubble-from')!,
);
const tagEl = document.getElementById('tag')!;
const stageEl = document.getElementById('stage')!;

let character: Character;
let working = false; // entre o prompt e o Stop do Claude
let current: StateName = 'idle';
let stateTimer: number | undefined;
let sleepTimer: number | undefined;
let talkTimer: number | undefined;
let walking = false;
let hovering = false;
let dragging = false;
let leaving = false;
const gesture = new PointerGesture();
/** Movimento reduzido: pedido no menu (main) ou no sistema (prefers-reduced-motion) */
let motionFromMenu = false;
const systemReduced = window.matchMedia('(prefers-reduced-motion: reduce)');
const reducedMotion = (): boolean => motionFromMenu || systemReduced.matches;
/** Trecho de passeio em andamento (executado aqui, a cada quadro da tela) */
let walkPlan: { plan: WalkPlan; startedAt: number; last: Point | null } | null = null;

const baseState = (): StateName => (working ? 'thinking' : 'idle');

// ---------- estados ----------

function setState(name: StateName, opts: Pick<CompanionEvent, 'expression' | 'anim' | 'duration'> = {}): void {
  const def = STATE_DEFS[name];
  current = name;
  const expression = opts.expression ?? def.expression;
  const anim = opts.anim ?? def.anim;
  // expressão/animação vindas do evento (MCP) também mudam a pose das skins
  const pose = opts.expression || opts.anim ? (poseFor(opts.expression, opts.anim) ?? def.pose) : def.pose;
  character.show({ pose, expression, anim });
  character.setProp(def.prop);

  window.clearTimeout(stateTimer);
  const duration = opts.duration ?? def.duration ?? (def.tool ? TOOL_STATE_TIMEOUT : undefined);
  if (duration) stateTimer = window.setTimeout(() => setState(baseState()), duration);

  window.clearTimeout(sleepTimer);
  if (name === 'idle') sleepTimer = window.setTimeout(() => setState('sleeping'), SLEEP_AFTER);
  updateWalkAllowed();
}

/** Reação passageira: não troca o estado, só o "enfeita" e depois volta pra ele */
function react({ pose, expression, anim, say: text, duration = 2500 }: Reaction): void {
  const def = STATE_DEFS[current];
  const look: Look = {
    pose: pose ?? poseFor(expression, anim) ?? def.pose,
    expression: expression ?? def.expression,
    anim: anim ?? null,
  };
  character.show(look);
  if (text) say(text);
  window.clearTimeout(stateTimer);
  stateTimer = window.setTimeout(() => setState(current), duration);
}

/** Balão + boca mexendo enquanto o texto é "digitado" */
function say(text: string, from?: string): void {
  const typing = bubble.say(text, from);
  character.setTalking(true);
  window.clearTimeout(talkTimer);
  talkTimer = window.setTimeout(() => character.setTalking(false), typing + 300);
}

function handleEvent(ev: CompanionEvent): void {
  if (ev.working !== undefined) working = ev.working;
  if (ev.state) setState(ev.state, ev);
  else if (ev.expression || ev.anim) react({ expression: ev.expression, anim: ev.anim, duration: ev.duration });
  if (ev.say) say(ev.say, ev.from);
  updateWalkAllowed();
}

function onIdentity({ label, color }: Identity): void {
  document.documentElement.style.setProperty('--hair', color);
  tagEl.textContent = label ?? '';
  tagEl.classList.toggle('empty', !label);
}

function onLeave(): void {
  leaving = true;
  updateWalkAllowed();
  react({ pose: 'wave', expression: 'happy', anim: 'wave', say: pick(['Tchau! 👋', 'Até mais!', 'Fui! ✨']), duration: 5000 });
  stageEl.classList.add('leaving');
}

// ---------- passeio ----------

let lastAllowed: boolean | null = null;
function updateWalkAllowed(): void {
  const allowed = current === 'idle' && !working && !hovering && !dragging && !leaving && !reducedMotion();
  if (allowed === lastAllowed) return;
  lastAllowed = allowed;
  api?.setWalkAllowed(allowed);
}

function onWalk({ walking: isWalking, dir, plan }: WalkInfo): void {
  walking = isWalking;
  walkPlan = isWalking && plan ? { plan, startedAt: performance.now(), last: null } : null;
  if (!dragging) character.setMotion(walking ? 'walk' : null, dir);
}

/** Um quadro do passeio: a janela anda no mesmo quadro em que o corpo é desenhado */
function stepWalk(now: number): void {
  if (!walkPlan) return;
  const { position, done } = walkStep(walkPlan.plan, now - walkPlan.startedAt);
  if (!walkPlan.last || position.x !== walkPlan.last.x || position.y !== walkPlan.last.y) {
    api?.walkTo(position.x, position.y);
    walkPlan.last = position;
  }
  if (done) {
    walkPlan = null;
    api?.walkArrived();
  }
}

function onMotion({ reduced }: MotionInfo): void {
  motionFromMenu = reduced;
  applyReducedMotion();
}

function applyReducedMotion(): void {
  character.setReducedMotion(reducedMotion());
  updateWalkAllowed();
}

function onMode({ mode, announce }: ModeInfo): void {
  if (!announce) return;
  react(mode === 'stay'
    ? { expression: 'happy', anim: 'perk', pose: 'happy', say: pick(['Ok, vou ficar aqui!', 'Fico quietinha aqui 👍']) }
    : { expression: 'happy', anim: 'jump', say: pick(['Oba, vou dar uma volta!', 'Hora de passear! 🐾']) });
}

// ---------- mouse ----------

const petting = new PetDetector(() => {
  if (current === 'sleeping') return void say('zzz... ♥');
  react({ pose: 'happy', expression: 'happy', anim: 'breathe', say: pick(['Hehe ♥', 'Que carinho bom~', 'Nyaa~ 😊']), duration: 3000 });
});

/** Clique (não arrasto, não carinho): o main abre a interface; aqui ela só reage */
function onClick(): void {
  api?.notifyClick();
  if (current === 'sleeping') {
    setState('idle');
    react({ expression: 'surprised', anim: 'perk', say: pick(['Hã?! Tô acordada!', 'Oi! Só descansando o olho...']) });
    return;
  }
  // a interface está abrindo: reação curta, sem balão pra não competir com a janela
  react(working ? { expression: 'focused', anim: 'perk', duration: 900 } : { expression: 'happy', anim: 'perk', duration: 1200 });
}

const pendulum = new Pendulum();

function startDrag(): void {
  dragging = true;
  character.setMotion('drag', 1);
  pendulum.reset();
  if (Math.random() < 0.5) say(pick(['Uaaa!', 'Ei, me solta!', 'Wiii!']));
  updateWalkAllowed();
}

function endDrag(): void {
  dragging = false;
  character.setSwing(0);
  character.setMotion(null, 1);
  api?.dragEnd();
  react({ pose: 'idle', expression: 'neutral', anim: 'perk', duration: 800 });
  updateWalkAllowed();
}

function setHovering(over: boolean): void {
  if (over === hovering) return;
  hovering = over;
  document.body.classList.toggle('hovering', over);
  api?.setIgnoreMouse(!over); // fora do personagem, os cliques atravessam a janela
  if (!over) petting.reset();
  updateWalkAllowed();
}

/**
 * Posição do cursor vinda do main (a cada ~33ms). É a fonte de verdade do "mouse em
 * cima dela": não depende dos eventos repassados pelo setIgnoreMouseEvents, que no
 * Windows às vezes param de chegar e deixavam a Tera impossível de clicar.
 */
function onCursor(p: Point): void {
  if (!gesture.active) setHovering(character.hitTest(p.x, p.y));
  if (!walking && !dragging) character.lookAt(p);
}

/** Encerra um clique/arrasto (inclusive quando o "soltar" se perdeu fora da janela) */
function release(clicked: boolean): void {
  const ev = gesture.up(clicked);
  if (ev?.type === 'drag-end') endDrag();
  else if (ev?.type === 'click') onClick();
}

function bindMouse(): void {
  window.addEventListener('mousemove', (e) => {
    if (!gesture.active) {
      // com o recorte (Linux) os eventos só chegam dentro da área clicável: valem como hover
      setHovering(character.hitTest(e.clientX, e.clientY));
      if (hovering) petting.track(e.screenX);
      return;
    }
    // botão já solto e o mouseup não chegou (arrasto rápido escapou da janela)
    if (e.buttons === 0) return release(false);
    for (const ev of gesture.move(e.screenX, e.screenY)) {
      if (ev.type === 'drag-start') startDrag();
      else if (ev.type === 'drag') {
        api?.moveBy(ev.dx, ev.dy);
        pendulum.push(ev.dx);
      }
    }
  });

  // Cliques de verdade só chegam quando a janela não está ignorando o mouse; as
  // coordenadas deles são confiáveis, então o teste de pixel decide na hora.
  window.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || !character.hitTest(e.clientX, e.clientY)) return;
    gesture.down(e.screenX, e.screenY);
    setHovering(true);
  });

  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) release(true);
  });

  // perdeu o foco no meio do arrasto (Alt+Tab, outra janela por cima)
  window.addEventListener('blur', () => release(false));
  document.addEventListener('mouseleave', () => { if (!gesture.active) setHovering(false); });

  window.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (character.hitTest(e.clientX, e.clientY)) api?.openContextMenu();
  });

  // Reafirma o estado de tempos em tempos: se main e renderer divergirem por
  // qualquer motivo (recarregar, janela escondida/mostrada), se corrige sozinho.
  api?.setIgnoreMouse(true);
  window.setInterval(() => api?.setIgnoreMouse(!hovering && !gesture.active), 1000);
}

// ---------- área clicável (recorte da janela, usado no Linux) ----------

const SHAPE_EVERY_MS = 150;
/**
 * Folga em volta da caixa da personagem. O recorte também corta o DESENHO (não só o
 * clique), então ele é a caixa inteira dela, estável: recortar pelo contorno exato fazia
 * braço, cauda e ícone sumirem por um instante quando a pose mudava antes do recorte.
 */
const SHAPE_PAD = 16;
let lastShape = '';

function visibleRect(el: HTMLElement, hiddenClass?: string): Rect | null {
  if (hiddenClass && el.classList.contains(hiddenClass)) return null;
  const r = el.getBoundingClientRect();
  return r.width && r.height ? { x: r.left, y: r.top, width: r.width, height: r.height } : null;
}

/** Caixa da personagem (com o ícone ao lado), balão e plaquinha; arrastando, a janela toda */
function updateShape(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  let rects: Rect[];
  if (dragging || gesture.active) {
    rects = [{ x: 0, y: 0, width: w, height: h }];
  } else {
    const box = visibleRect(character.root);
    rects = box ? [padRect(box, SHAPE_PAD)] : [];
    const prop = character.root.querySelector<HTMLElement>('.prop');
    for (const extra of [prop?.textContent ? visibleRect(prop) : null, visibleRect(document.getElementById('bubble')!, 'hidden'), visibleRect(tagEl, 'empty')]) {
      if (extra) rects.push(padRect(extra, 4));
    }
  }
  rects = clipRects(rects.map((r) => ({ x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) })), w, h);
  // lista vazia faria a janela inteira voltar a ser clicável: um ponto no canto no lugar
  if (!rects.length) rects = [{ x: 0, y: 0, width: 1, height: 1 }];
  const key = JSON.stringify(rects);
  if (key === lastShape) return;
  lastShape = key;
  api?.setShape(rects);
}

// ---------- inicialização ----------

function resetCharacterEl(): void {
  characterEl.removeAttribute('style');
  characterEl.className = '';
  characterEl.replaceChildren();
}

// Ordem: skin escolhida → (se for um rig e falhar) a skin original da Tera → desenho SVG
async function createCharacter(): Promise<Character> {
  let skin = await api?.getSkin().catch(() => null);
  if (skin?.rig) {
    try {
      return await RigCharacter.create(characterEl, skin);
    } catch (err) {
      console.error('[teracota] rig falhou, usando a skin original:', err);
      resetCharacterEl();
      skin = await api?.getFallbackSkin().catch(() => null);
    }
  }
  if (skin && !skin.rig) {
    try {
      return await SpriteCharacter.create(characterEl, skin);
    } catch (err) {
      console.error('[teracota] skin falhou, usando o desenho:', err);
      resetCharacterEl();
    }
  }
  return new SvgCharacter(characterEl);
}

// O main manda identidade/modo/eventos assim que a página carrega, mas a skin ainda
// está carregando: guarda tudo e aplica quando o personagem existir.
let ready = false;
const pending: Array<() => void> = [];
const whenReady = <A extends unknown[]>(fn: (...args: A) => void) => (...args: A): void => {
  if (ready) fn(...args);
  else pending.push(() => fn(...args));
};

if (api) {
  api.onEvent(whenReady(handleEvent));
  api.onWalk(whenReady(onWalk));
  api.onMode(whenReady(onMode));
  api.onIdentity(whenReady(onIdentity));
  api.onLeave(whenReady(onLeave));
  api.onMotion(whenReady(onMotion));
  api.onCursor((p) => { if (ready) onCursor(p); });
}

/** Um relógio pra janela: passeio, balanço do arrasto e desenho no mesmo quadro da tela */
const clock = new FrameClock((now) => {
  stepWalk(now);
  if (dragging) character.setSwing(reducedMotion() ? 0 : pendulum.step(now));
  character.tick(now);
}, () => (walkPlan || dragging ? MOTION_FPS : character.targetFps()));

async function init(): Promise<void> {
  character = await createCharacter();
  character.setReducedMotion(reducedMotion());
  systemReduced.addEventListener('change', () => { if (ready) applyReducedMotion(); });
  clock.start();
  bindMouse();
  if (api) window.setInterval(updateShape, SHAPE_EVERY_MS);
  setState('idle');
  ready = true;
  for (const fn of pending.splice(0)) fn();
  if (!api) {
    // Aberto no navegador, sem Electron: expõe handlers pra testar pelo console
    Object.assign(window, { handleEvent, onWalk, onIdentity, onLeave });
    document.addEventListener('mousemove', (e) => onCursor({ x: e.clientX, y: e.clientY }));
  }
}

void init();
