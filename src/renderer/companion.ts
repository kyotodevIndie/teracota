// Renderer do Mini Companion: só desenha o CompanionView e repassa as interações.
// Quem decide o estado é o controller no main.
import type { CompanionAction, CompanionView } from '../shared/companion';
import type { Point } from '../shared/ipc';
import type { Pose, SkinInfo } from '../shared/skin';

const api = window.teracotaCompanion;
const $ = (id: string) => document.getElementById(id)!;
const card = $('card');
const frameEl = $('frame') as HTMLImageElement;
const OPEN_STATES = new Set(['EXPANDED', 'ATTENTION', 'DRAGGING', 'NOTIFICATION', 'PANEL']);
const DRAG_THRESHOLD = 4;

let view: CompanionView | null = null;

// ---------- a Tera (frames da skin) ----------

const FALLBACK: Record<Pose, Pose> = {
  idle: 'idle', walk: 'idle', drag: 'surprised', land: 'idle', work: 'think', think: 'idle',
  talk: 'idle', happy: 'wave', error: 'surprised', sad: 'idle', sleep: 'idle', wave: 'happy', surprised: 'idle',
};
let skin: SkinInfo | null = null;
let pose: Pose | null = null;
let frameTimer: number | undefined;

function resolvePose(p: Pose): Pose {
  let cur = p;
  for (let i = 0; i < 4 && !skin?.manifest.animations[cur]; i++) cur = FALLBACK[cur];
  return skin?.manifest.animations[cur] ? cur : 'idle';
}

function playPose(p: Pose): void {
  if (!skin || p === pose) return;
  pose = p;
  window.clearTimeout(frameTimer);
  const anim = skin.manifest.animations[resolvePose(p)];
  if (!anim) return;
  let i = 0;
  const step = () => {
    frameEl.src = skin!.baseUrl + anim.frames[i]!;
    const d = anim.durations[i] ?? 200;
    i = (i + 1) % anim.frames.length;
    if (anim.frames.length > 1 && (anim.loop !== false || i !== 0)) frameTimer = window.setTimeout(step, d);
  };
  step();
}

// ---------- desenho do view ----------

function button(a: CompanionAction, notificationId?: string, primary = false): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = a.label;
  if (primary) b.className = 'primary';
  b.onclick = () => api?.input({ type: 'action', id: a.id, notificationId });
  return b;
}

function render(v: CompanionView): void {
  view = v;
  card.dataset.state = v.state;
  card.dataset.kind = v.notification?.kind ?? '';
  card.classList.toggle('open', OPEN_STATES.has(v.state));
  card.classList.toggle('anchor-left', v.anchor === 'left');
  card.classList.toggle('anchor-right', v.anchor === 'right');
  playPose(v.pose);

  $('activity').hidden = !v.working;
  const badge = $('badge');
  badge.hidden = v.pendingCount === 0 || v.state === 'ATTENTION';
  badge.textContent = String(v.pendingCount);

  const n = v.notification;
  $('title').textContent = n ? n.title : v.context.title;
  $('origin').textContent = n?.origin ?? '';
  const count = $('count');
  count.hidden = !n || n.count < 2;
  count.textContent = n ? `×${n.count}` : '';
  $('message').textContent = n ? n.message : v.context.detail;

  const drop = $('drop');
  drop.hidden = !v.drop;
  $('drop-hint').textContent = v.drop?.hint ?? '';
  $('drop-note').textContent = v.drop?.note ?? '';

  // no máximo duas ações + navegação quando há várias notificações
  const actions = $('actions');
  actions.replaceChildren();
  const row = document.createElement('div');
  row.className = 'row';
  if (n) row.append(...n.actions.slice(0, 2).map((a, i) => button(a, n.id, i === 0 && v.state === 'ATTENTION')));
  else row.append(...v.actions.slice(0, 2).map((a) => button(a)));
  actions.append(row);
  if (n && v.queue.total > 1) {
    const pager = document.createElement('div');
    pager.className = 'row';
    const prev = document.createElement('button');
    prev.className = 'nav';
    prev.textContent = '‹';
    prev.setAttribute('aria-label', 'Anterior');
    prev.onclick = () => api?.input({ type: 'navigate', delta: -1 });
    const next = document.createElement('button');
    next.className = 'nav';
    next.textContent = '›';
    next.setAttribute('aria-label', 'Próxima');
    next.onclick = () => api?.input({ type: 'navigate', delta: 1 });
    const label = document.createElement('span');
    label.className = 'pager';
    label.textContent = `${v.queue.index + 1}/${v.queue.total}`;
    pager.append(prev, label, next);
    actions.append(pager);
  }
}

// ---------- mouse ----------

let hovering = false;
let pressed: (Point & { moved: number }) | null = null;
let dragging = false;

function overCard(p: Point): boolean {
  const r = card.getBoundingClientRect();
  return p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;
}

function setHovering(over: boolean): void {
  if (over === hovering) return;
  hovering = over;
  card.classList.toggle('hover-feedback', over);
  api?.setIgnoreMouse(!over); // fora do cartão, o clique atravessa a janela
  api?.input({ type: 'hover', over });
}

function onCursor(p: Point): void {
  if (!pressed && !fileDepth) setHovering(overCard(p));
}

const tera = $('tera');
tera.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  pressed = { x: e.screenX, y: e.screenY, moved: 0 };
});
// teclado: Enter/Espaço no botão da Tera fazem o mesmo que o clique
tera.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  e.preventDefault();
  api?.input({ type: 'click' });
});
window.addEventListener('mousemove', (e) => {
  if (!pressed) return;
  if (e.buttons === 0) return release(false);
  const dx = e.screenX - pressed.x;
  const dy = e.screenY - pressed.y;
  pressed = { x: e.screenX, y: e.screenY, moved: pressed.moved + Math.abs(dx) + Math.abs(dy) };
  if (!dragging && pressed.moved > DRAG_THRESHOLD) dragging = true;
  if (dragging) api?.moveBy(dx, dy);
});
window.addEventListener('mouseup', (e) => { if (e.button === 0) release(true); });
window.addEventListener('blur', () => release(false));

function release(clicked: boolean): void {
  if (!pressed) return;
  pressed = null;
  if (dragging) {
    dragging = false;
    api?.dragEnd();
  } else if (clicked) {
    api?.input({ type: 'click' });
  }
}

window.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (overCard({ x: e.clientX, y: e.clientY })) api?.openContextMenu();
});

// ---------- arrastar arquivos ----------
// dragenter/dragleave disparam em cada elemento filho: um contador evita piscar.

let fileDepth = 0;
const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');

window.addEventListener('dragenter', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  if (fileDepth++ === 0) api?.input({ type: 'drag-files', over: true });
});
window.addEventListener('dragover', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  e.dataTransfer!.dropEffect = 'copy';
});
window.addEventListener('dragleave', (e) => {
  if (!hasFiles(e) || fileDepth === 0) return;
  if (--fileDepth === 0) api?.input({ type: 'drag-files', over: false });
});
window.addEventListener('drop', (e) => {
  e.preventDefault();
  if (!hasFiles(e)) return;
  fileDepth = 0;
  const names = [...(e.dataTransfer?.files ?? [])].map((f) => f.name);
  api?.input({ type: 'drop-files', names });
});

// ---------- início ----------

async function init(): Promise<void> {
  // registra antes de esperar a skin: o primeiro view chega junto com o carregamento
  api?.onView(render);
  api?.onCursor(onCursor);
  // reafirma o estado do clique-atravessa de tempos em tempos (como na Tera completa)
  window.setInterval(() => api?.setIgnoreMouse(!hovering && !pressed && !fileDepth), 1000);
  skin = (await api?.getSkin().catch(() => null)) ?? null;
  if (!skin) frameEl.alt = 'Tera';
  pose = null;
  if (view) render(view);
  else playPose('idle');
}

void init();
