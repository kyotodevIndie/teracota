// Cérebro do personagem: estados vindos do Claude, passeio e interação com o mouse.
import type { Identity, ModeInfo, Point, WalkInfo } from '../shared/ipc';
import type { Anim, Expression, StateName, CompanionEvent } from '../shared/protocol';
import type { Pose } from '@tera/character/skin';
import { Bubble } from './bubble';
import type { Character } from './character';
import { poseFor, type Look } from './look';
import { Pendulum } from './pendulum';
import { PetDetector } from './pet';
import { RigCharacter } from './rig/rig-character';
import { SpriteCharacter } from './sprite-character';
import { SLEEP_AFTER, STATE_DEFS, TOOL_STATE_TIMEOUT } from './states';
import { SvgCharacter } from './svg-character';

interface Reaction {
  pose?: Pose;
  expression?: Expression;
  anim?: Anim;
  say?: string;
  duration?: number;
}

const DRAG_THRESHOLD = 4;
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
let pressed: (Point & { moved: number }) | null = null;

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
  const allowed = current === 'idle' && !working && !hovering && !dragging && !leaving;
  if (allowed === lastAllowed) return;
  lastAllowed = allowed;
  api?.setWalkAllowed(allowed);
}

function onWalk({ walking: isWalking, dir }: WalkInfo): void {
  walking = isWalking;
  if (!dragging) character.setMotion(walking ? 'walk' : null, dir);
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

function onClick(): void {
  api?.notifyClick();
  if (current === 'sleeping') {
    setState('idle');
    react({ expression: 'surprised', anim: 'perk', say: pick(['Hã?! Tô acordada!', 'Só descansando o olho...']) });
    return;
  }
  if (working) {
    react({ expression: 'focused', say: pick(['Pera, tô trabalhando!', 'Quase lá...', 'Shh, concentrada 🤓']) });
    return;
  }
  react(pick<Reaction>([
    { expression: 'happy', anim: 'jump', say: 'Oi! 👋' },
    { expression: 'surprised', anim: 'perk', say: 'Hm?' },
    { expression: 'happy', anim: 'wave', say: 'Bora codar?' },
    { expression: 'happy', anim: 'jump', say: 'Hehe' },
  ]));
}

const pendulum = new Pendulum();
let swingFrame: number | undefined;

function swingLoop(now: number): void {
  character.setSwing(pendulum.step(now));
  swingFrame = requestAnimationFrame(swingLoop);
}

function startDrag(): void {
  dragging = true;
  character.setMotion('drag', 1);
  pendulum.reset();
  swingFrame = requestAnimationFrame(swingLoop);
  if (Math.random() < 0.5) say(pick(['Uaaa!', 'Ei, me solta!', 'Wiii!']));
  updateWalkAllowed();
}

function endDrag(): void {
  dragging = false;
  if (swingFrame !== undefined) cancelAnimationFrame(swingFrame);
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
  if (!pressed) setHovering(character.hitTest(p.x, p.y));
  if (!walking && !dragging) character.lookAt(p);
}

/** Encerra um clique/arrasto (inclusive quando o "soltar" se perdeu fora da janela) */
function release(clicked: boolean): void {
  if (!pressed) return;
  pressed = null;
  if (dragging) endDrag();
  else if (clicked) onClick();
}

function bindMouse(): void {
  window.addEventListener('mousemove', (e) => {
    if (!pressed) {
      if (hovering) petting.track(e.screenX);
      return;
    }
    // botão já solto e o mouseup não chegou (arrasto rápido escapou da janela)
    if (e.buttons === 0) return release(false);
    const dx = e.screenX - pressed.x;
    const dy = e.screenY - pressed.y;
    pressed = { x: e.screenX, y: e.screenY, moved: pressed.moved + Math.abs(dx) + Math.abs(dy) };
    if (!dragging && pressed.moved > DRAG_THRESHOLD) startDrag();
    if (dragging) {
      api?.moveBy(dx, dy);
      pendulum.push(dx);
    }
  });

  // Cliques de verdade só chegam quando a janela não está ignorando o mouse; as
  // coordenadas deles são confiáveis, então o teste de pixel decide na hora.
  window.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || !character.hitTest(e.clientX, e.clientY)) return;
    pressed = { x: e.screenX, y: e.screenY, moved: 0 };
    setHovering(true);
  });

  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) release(true);
  });

  // perdeu o foco no meio do arrasto (Alt+Tab, outra janela por cima)
  window.addEventListener('blur', () => release(false));

  window.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (character.hitTest(e.clientX, e.clientY)) api?.openContextMenu();
  });

  // Reafirma o estado de tempos em tempos: se main e renderer divergirem por
  // qualquer motivo (recarregar, janela escondida/mostrada), se corrige sozinho.
  api?.setIgnoreMouse(true);
  window.setInterval(() => api?.setIgnoreMouse(!hovering && !pressed), 1000);
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
  api.onCursor((p) => { if (ready) onCursor(p); });
}

async function init(): Promise<void> {
  character = await createCharacter();
  bindMouse();
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
