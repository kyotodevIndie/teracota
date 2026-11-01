// Skin Studio (navegador): monta e anima um rig da Tera com o mesmo motor do app.
//   Montar: clique escolhe a camada; arrastar muda a posição; Alt+arrastar muda o pivô
//           (a imagem fica no lugar); roda do mouse gira; na aba Poses, tudo isso vale
//           pra pose escolhida. Espaço+arrastar (ou botão do meio) move a vista; Ctrl+roda dá zoom.
//   Testar: a figura anima como no app, em cada estado (pensando, editando, esperando...).
// Salva no rig.json pela API do `tera-skin studio`; o que muda no disco aparece aqui.
import { type Mat, apply, parseRigManifest } from '@tera/character/rig';
import { RigPreview, type PreviewInput } from '@tera/character/preview';
import { RigScene } from '@tera/character/scene';
import { CHARACTER_STATES } from '@tera/character/states';
import type { SkinReport, SkinState } from '../studio-api';
import { type RawRig, addLayer, layer, movePivot, moveLayer, nudgePose, setLayerValue, setPoseValue, structureKey, toParentSpace, tree } from './edit';
import { h, renderInspector } from './inspector';
import { Store, type Tab } from './store';

const token = new URLSearchParams(location.search).get('t') ?? '';
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

async function api<T>(method: string, path: string, body?: BodyInit, type = 'application/json'): Promise<{ status: number; data: T }> {
  const res = await fetch(path, { method, body, headers: { 'x-tera-token': token, ...(body ? { 'Content-Type': type } : {}) } });
  return { status: res.status, data: (await res.json()) as T };
}

// ---------- estado ----------

let skin!: SkinState;
let store!: Store;
let report: SkinReport | null = null;
let scene: RigScene | null = null;
let preview: RigPreview | null = null;
let sceneKey = '';
let loading: Promise<void> | null = null;
let zoom = 1;
let pan: [number, number] = [0, 0];
const canvas = $<HTMLCanvasElement>('stage');
const ctx = canvas.getContext('2d')!;

function toast(msg: string, kind?: 'error'): void {
  const t = $('toast');
  t.textContent = msg;
  if (kind) t.dataset.kind = kind;
  else delete t.dataset.kind;
  t.hidden = false;
  clearTimeout((toast as unknown as { timer?: number }).timer);
  (toast as unknown as { timer?: number }).timer = window.setTimeout(() => { t.hidden = true; }, kind ? 6000 : 2500);
}

// ---------- cena (carrega as imagens só quando a estrutura muda) ----------

async function syncScene(): Promise<void> {
  const parsed = parseRigManifest(store.raw);
  if (!parsed.rig) return; // com erro, a figura fica como estava; a aba Conferir mostra o porquê
  const key = structureKey(store.raw) + JSON.stringify(store.raw.layers.map((l) => l.z ?? 0));
  if (scene && key === sceneKey) {
    // só números: atualiza no lugar (a cena e o animador usam os mesmos objetos)
    const byId = new Map(parsed.rig.layers.map((l) => [l.id, l]));
    for (const l of scene.rig.layers) Object.assign(l, byId.get(l.id));
    const controllersChanged = JSON.stringify(scene.rig.controllers) !== JSON.stringify(parsed.rig.controllers);
    Object.assign(scene.rig, { canvas: parsed.rig.canvas, feet: parsed.rig.feet, poses: parsed.rig.poses, expressions: parsed.rig.expressions, controllers: parsed.rig.controllers });
    if (controllersChanged) preview?.reset(Math.random, performance.now());
    return;
  }
  sceneKey = key;
  const side = Math.max(canvas.width, canvas.height);
  try {
    const next = await RigScene.load(parsed.rig, `${location.origin}/skin/`, Math.min(1, (side * 2) / parsed.rig.canvas));
    if (sceneKey !== key) return; // outra mudança chegou durante o carregamento
    scene = next;
    preview = new RigPreview(next, Math.random, performance.now());
  } catch (err) {
    toast((err as Error).message, 'error');
  }
}

function refreshScene(): void {
  loading = (loading ?? Promise.resolve()).then(syncScene);
}

// ---------- validação ----------

let validateTimer: number | undefined;
function scheduleValidate(): void {
  clearTimeout(validateTimer);
  validateTimer = window.setTimeout(async () => {
    const { data } = await api<SkinReport>('POST', '/api/validate', JSON.stringify(store.raw));
    report = data;
    renderChrome();
    if (store.tab === 'report') renderInspector(store, report, toast);
  }, 250);
}

// ---------- desenho ----------

/** O que a figura mostra agora, conforme o modo e a aba */
function previewInput(): PreviewInput {
  const opt = (id: string) => $<HTMLInputElement>(id).checked;
  const base = { facing: skin.facing, size: skin.size, debug: opt('opt-debug'), reducedMotion: opt('opt-reduced') };
  if (store.playing) {
    const s = CHARACTER_STATES.find((x) => x.id === store.playState) ?? CHARACTER_STATES[0]!;
    return { ...base, pose: s.pose, expression: s.expression, talking: opt('opt-talk'), motion: opt('opt-walk') ? 'walk' : null, dir: 1 };
  }
  // montando: figura parada; na aba Poses mostra a pose, na de Expressões a expressão
  if (store.tab === 'pose') return { ...base, still: true, pose: store.pose, expression: 'neutral' };
  if (store.tab === 'expr') return { ...base, still: true, pose: '', expression: store.expression };
  return { ...base, still: true, pose: '', expression: 'neutral' };
}

function frame(now: number): void {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(canvas.clientWidth * dpr);
  const hh = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== hh) {
    canvas.width = w;
    canvas.height = hh;
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, hh);
  if (scene && preview) {
    const rig = scene.rig;
    const s = (Math.min(w, hh) / rig.canvas) * zoom;
    const ox = (w - rig.canvas * s) / 2 + pan[0];
    const oy = (hh - rig.canvas * s) / 2 + pan[1];
    // moldura do canvas do rig e linha dos pés
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.strokeRect(ox, oy, rig.canvas * s, rig.canvas * s);
    ctx.strokeStyle = 'rgba(232,135,95,0.45)';
    ctx.beginPath();
    ctx.moveTo(ox, oy + rig.feet[1] * s);
    ctx.lineTo(ox + rig.canvas * s, oy + rig.feet[1] * s);
    ctx.stroke();
    preview.draw(ctx, now, previewInput(), zoom, pan);
    if (!store.playing) drawSelection();
  }
  requestAnimationFrame(frame);
}

/** Contorno da camada escolhida e o pivô dela */
function drawSelection(): void {
  const id = store.selected;
  if (!id || !scene || !preview?.root) return;
  const world = scene.worldOf(id);
  const size = scene.sizeOf(id);
  const l = layer(store.raw, id);
  if (!world || !size || !l) return;
  const m: Mat = mul(preview.root, world);
  const corners = [[0, 0], [size.width, 0], [size.width, size.height], [0, size.height]].map(([x, y]) => apply(m, x!, y!));
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.strokeStyle = '#e8875f';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  corners.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.stroke();
  ctx.setLineDash([]);
  const [px, py] = apply(m, l.pivot[0], l.pivot[1]);
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#e11d48';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(px, py, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

const mul = (m: Mat, n: Mat): Mat => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];

// ---------- mexer na figura ----------

/** Ponto do mouse → px do canvas (com a densidade da tela) */
const canvasPoint = (e: MouseEvent): [number, number] => {
  const r = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  return [(e.clientX - r.left) * dpr, (e.clientY - r.top) * dpr];
};

/** Vetor em px do canvas → px do rig */
function canvasToRig(dx: number, dy: number): [number, number] {
  const inv = preview?.inverseRoot;
  if (!inv) return [dx, dy];
  return [inv[0] * dx + inv[2] * dy, inv[1] * dx + inv[3] * dy];
}

let drag: { kind: 'layer' | 'pivot' | 'pan'; last: [number, number] } | null = null;
let spaceDown = false;

canvas.addEventListener('mousedown', (e) => {
  canvas.focus();
  const p = canvasPoint(e);
  if (e.button === 1 || spaceDown) {
    drag = { kind: 'pan', last: p };
    canvas.classList.add('dragging');
    e.preventDefault();
    return;
  }
  if (e.button !== 0 || store.playing || !preview?.inverseRoot || !scene) return;
  const [rx, ry] = apply(preview.inverseRoot, p[0], p[1]);
  const hit = scene.hit(rx, ry);
  // clique em cima da camada já escolhida (ou Alt) arrasta ela; em outra, escolhe
  if (hit && hit !== store.selected && !e.altKey) store.select(hit);
  if (!store.selected) return;
  if (store.tab === 'expr') return;
  drag = { kind: e.altKey && store.tab !== 'pose' ? 'pivot' : 'layer', last: p };
  canvas.classList.add('dragging');
});

window.addEventListener('mousemove', (e) => {
  if (!drag) return;
  const p = canvasPoint(e);
  const delta: [number, number] = [p[0] - drag.last[0], p[1] - drag.last[1]];
  drag.last = p;
  if (drag.kind === 'pan') {
    pan = [pan[0] + delta[0], pan[1] + delta[1]];
    return;
  }
  const id = store.selected!;
  const l = layer(store.raw, id);
  if (!l || !scene) return;
  const rigDelta = canvasToRig(delta[0], delta[1]);
  if (drag.kind === 'pivot') {
    const world = scene.worldOf(id);
    const local = world ? toParentSpace(world, rigDelta[0], rigDelta[1]) : rigDelta;
    store.live(movePivot(store.raw, id, local));
    return;
  }
  const parentWorld = l.parent ? scene.worldOf(l.parent) ?? null : null;
  const parentDelta = toParentSpace(parentWorld, rigDelta[0], rigDelta[1]);
  store.live(store.tab === 'pose' ? nudgePose(store.raw, store.pose, id, parentDelta) : moveLayer(store.raw, id, parentDelta));
});

window.addEventListener('mouseup', () => {
  if (!drag) return;
  if (drag.kind !== 'pan') store.commit(store.raw);
  drag = null;
  canvas.classList.remove('dragging');
});

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (e.ctrlKey || e.metaKey || !store.selected || store.playing || store.tab === 'expr') {
    // zoom em volta do mouse
    const k = Math.exp(-e.deltaY * 0.0015);
    const next = Math.min(8, Math.max(0.2, zoom * k));
    const [mx, my] = canvasPoint(e);
    const cx = canvas.width / 2 + pan[0];
    const cy = canvas.height / 2 + pan[1];
    pan = [pan[0] + (mx - cx) * (1 - next / zoom), pan[1] + (my - cy) * (1 - next / zoom)];
    zoom = next;
    return;
  }
  const step = (e.shiftKey ? 5 : 1) * Math.sign(e.deltaY);
  const id = store.selected;
  const l = layer(store.raw, id)!;
  if (store.tab === 'pose') {
    const cur = store.raw.poses?.[store.pose]?.layers[id]?.rotation ?? 0;
    store.commit(setPoseValue(store.raw, store.pose, id, 'rotation', cur + step));
  } else {
    store.commit(setLayerValue(store.raw, id, 'rotation', ((l.rotation ?? 0) + step) || undefined));
  }
}, { passive: false });

// ---------- teclado ----------

window.addEventListener('keydown', (e) => {
  const typing = (e.target as Element | null)?.matches?.('input, textarea, select') ?? false;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    void save();
    return;
  }
  if (typing) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (e.shiftKey) store.redo();
    else store.undo();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    store.redo();
    return;
  }
  if (e.key === ' ') {
    spaceDown = true;
    e.preventDefault();
    return;
  }
  // setas: empurra 1 px (Shift: 10)
  const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  const dir = arrows[e.key];
  if (dir && store.selected && !store.playing) {
    e.preventDefault();
    const k = e.shiftKey ? 10 : 1;
    const d: [number, number] = [dir[0] * k, dir[1] * k];
    store.commit(store.tab === 'pose' ? nudgePose(store.raw, store.pose, store.selected, d) : moveLayer(store.raw, store.selected, d));
  }
});
window.addEventListener('keyup', (e) => { if (e.key === ' ') spaceDown = false; });

// ---------- lista de camadas e de arquivos ----------

function renderLayers(): void {
  const usedFiles = new Set(store.raw.layers.flatMap((l) => [l.image, ...Object.values(l.variants ?? {})]));
  $('layers').replaceChildren(...tree(store.raw).map(({ layer: l, depth }) => {
    const thumb = h('img', { className: 'thumb', src: `/skin/${l.image}`, alt: '' });
    const li = h('li', {},
      thumb,
      h('span', { className: 'name', textContent: l.id }),
      ...(l.visible === false ? [h('span', { className: 'hidden-mark', textContent: 'oculta' })] : []),
      h('span', { className: 'z', textContent: `z ${l.z ?? 0}` }));
    li.style.paddingLeft = `${6 + depth * 14}px`;
    li.setAttribute('aria-selected', String(l.id === store.selected));
    li.onclick = () => store.select(l.id);
    return li;
  }));
  $('files').replaceChildren(...store.files.map((f) => h('li', { className: usedFiles.has(f.path) ? '' : 'unused', title: usedFiles.has(f.path) ? '' : 'nenhuma camada usa' },
    h('span', { textContent: f.path }), h('span', { className: 'size', textContent: `${f.width}×${f.height}` }))));
}

function renderChrome(): void {
  $('skin-name').textContent = skin.name;
  $('dirty').hidden = !store.dirty;
  $<HTMLButtonElement>('undo').disabled = !store.canUndo;
  $<HTMLButtonElement>('redo').disabled = !store.canRedo;
  const chip = $('report-chip');
  if (!report) chip.textContent = 'conferindo…';
  else if (!report.ok) {
    chip.textContent = `${report.errors.length} erro${report.errors.length > 1 ? 's' : ''}`;
    chip.dataset.level = 'error';
  } else if (report.warnings.length) {
    chip.textContent = `ok · ${report.warnings.length} aviso${report.warnings.length > 1 ? 's' : ''}`;
    chip.dataset.level = 'warn';
  } else {
    chip.textContent = 'tudo certo';
    chip.dataset.level = 'ok';
  }
  $<HTMLButtonElement>('save').disabled = !store.dirty;
  $('mode-edit').setAttribute('aria-pressed', String(!store.playing));
  $('mode-play').setAttribute('aria-pressed', String(store.playing));
  $('play-states').hidden = !store.playing;
  for (const b of $('play-states').children) b.setAttribute('aria-pressed', String((b as HTMLElement).dataset.state === store.playState));
  $('stage-hint').textContent = store.playing
    ? 'Testar: a figura anima como no app. Escolha um estado.'
    : store.tab === 'pose'
      ? `Pose "${store.pose}": arraste a camada; roda gira; setas empurram.`
      : 'Clique escolhe · arrastar move · Alt+arrastar move o pivô · roda gira · Ctrl+roda zoom · Espaço+arrastar vista';
  const json = $<HTMLTextAreaElement>('json-text');
  if (document.activeElement !== json) json.value = JSON.stringify(store.raw, null, 2);
}

// ---------- salvar, recarregar, partes novas ----------

async function save(): Promise<void> {
  if (!store.dirty) return;
  const { status, data } = await api<SkinReport>('PUT', '/api/rig', JSON.stringify(store.raw));
  report = data;
  if (status === 200) {
    store.markSaved();
    toast('Salvo no rig.json');
  } else {
    store.set('tab', 'report');
    toast('Não salvei: a Tera não carregaria o rig assim (veja Conferir).', 'error');
  }
  renderChrome();
}

async function load(): Promise<void> {
  const { data } = await api<SkinState>('GET', '/api/skin');
  skin = data;
  report = data.report;
}

async function uploadParts(files: FileList | File[]): Promise<void> {
  for (const file of Array.from(files).filter((f) => f.name.toLowerCase().endsWith('.png'))) {
    const name = file.name.toLowerCase().replace(/[^a-z0-9_.-]+/g, '_');
    let { status, data } = await api<{ path: string; width: number; height: number; error?: string }>('POST', `/api/parts?file=${encodeURIComponent(`parts/${name}`)}`, file, 'image/png');
    if (status === 409 && confirm(`parts/${name} já existe. Substituir?`)) {
      ({ status, data } = await api<typeof data>('POST', `/api/parts?file=${encodeURIComponent(`parts/${name}`)}&overwrite=1`, file, 'image/png'));
      if (status === 200) {
        toast(`parts/${name} substituído`);
        continue;
      }
    }
    if (status !== 200) {
      toast(data.error ?? `não consegui enviar ${file.name}`, 'error');
      continue;
    }
    store.files = [...store.files.filter((f) => f.path !== data.path), { path: data.path, width: data.width, height: data.height }];
    const next = addLayer(store.raw, data.path, data, store.selected);
    store.commit(next);
    store.select(next.layers[next.layers.length - 1]!.id);
    toast(`Camada nova com ${data.path}`);
  }
}

document.addEventListener('dragover', (e) => {
  e.preventDefault();
  document.body.classList.add('drop-target');
});
document.addEventListener('dragleave', (e) => { if (!e.relatedTarget) document.body.classList.remove('drop-target'); });
document.addEventListener('drop', (e) => {
  e.preventDefault();
  document.body.classList.remove('drop-target');
  if (e.dataTransfer?.files.length) void uploadParts(e.dataTransfer.files);
});

$('add-layer').onclick = () => {
  const used = new Set(store.raw.layers.map((l) => l.image));
  const free = store.files.filter((f) => !used.has(f.path));
  const choice = prompt(`Arquivo da camada nova (PNG da pasta):\n${(free.length ? free : store.files).map((f) => f.path).join('\n')}`, free[0]?.path ?? '');
  const file = store.files.find((f) => f.path === choice?.trim());
  if (!file) return;
  const next = addLayer(store.raw, file.path, file, store.selected);
  store.commit(next);
  store.select(next.layers[next.layers.length - 1]!.id);
};

// arquivo mudou no disco (o Codex salvou, uma parte nova): recarrega se não houver mudança aqui
const events = new EventSource(`/api/events?t=${token}`);
let diskRig: RawRig | null = null;
events.addEventListener('change', async () => {
  const prevKeyFiles = JSON.stringify(store.files);
  await load();
  store.files = skin.files;
  const disk = skin.rig as RawRig | null;
  if (disk && JSON.stringify(disk) !== JSON.stringify(store.raw)) {
    if (!store.dirty) {
      store.replace(disk);
      toast('rig.json recarregado do disco');
    } else {
      diskRig = disk;
      $('disk-banner').hidden = false;
    }
  }
  // PNG trocado com o mesmo nome: força recarregar as imagens
  if (JSON.stringify(store.files) !== prevKeyFiles || !disk) sceneKey = '';
  refreshScene();
  renderLayers();
  renderChrome();
});
$('disk-reload').onclick = () => {
  if (diskRig) store.replace(diskRig);
  diskRig = null;
  $('disk-banner').hidden = true;
};
$('disk-keep').onclick = () => {
  diskRig = null;
  $('disk-banner').hidden = true;
};

// ---------- botões ----------

$('save').onclick = () => void save();
$('undo').onclick = () => store.undo();
$('redo').onclick = () => store.redo();
$('report-chip').onclick = () => store.set('tab', 'report');
$('mode-edit').onclick = () => store.set('playing', false);
$('mode-play').onclick = () => {
  preview?.reset(Math.random, performance.now());
  store.set('playing', true);
};
$('zoom-reset').onclick = () => {
  zoom = 1;
  pan = [0, 0];
};
for (const b of document.querySelectorAll<HTMLButtonElement>('#tabs button')) b.onclick = () => store.set('tab', b.dataset.tab as Tab);
$('json-apply').onclick = () => {
  try {
    store.commit(JSON.parse($<HTMLTextAreaElement>('json-text').value) as RawRig);
    $('json-error').textContent = '';
  } catch (err) {
    $('json-error').textContent = (err as Error).message;
  }
};
$('play-states').replaceChildren(...CHARACTER_STATES.map((s) => {
  const b = h('button', { type: 'button', textContent: s.label, dataset: { state: s.id } });
  b.onclick = () => store.set('playState', s.id);
  return b;
}));
window.addEventListener('beforeunload', (e) => { if (store?.dirty) e.preventDefault(); });

// ---------- início ----------

void (async () => {
  await load();
  if (!skin.rig || typeof skin.rig !== 'object') {
    document.body.replaceChildren(h('p', { className: 'empty', textContent: `${skin.rigFile} ilegível. Corrija o arquivo (tera-skin validate) e recarregue.` }));
    return;
  }
  store = new Store(skin.rig as RawRig);
  store.files = skin.files;
  store.selected = tree(store.raw)[0]?.layer.id ?? null;
  store.onChange((why) => {
    if (why === 'rig') {
      refreshScene();
      scheduleValidate();
    }
    renderLayers();
    renderChrome();
    renderInspector(store, report, toast);
  });
  refreshScene();
  renderLayers();
  renderChrome();
  renderInspector(store, report, toast);
  requestAnimationFrame(frame);
})();
