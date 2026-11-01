// Painel da direita: Camada, Poses, Expressões, Movimentos e Conferir. Cada campo edita o
// rig.json cru pelo Store (entra no desfazer). Texto sempre por textContent.
import { POSES } from '@tera/character/skin';
import { CHARACTER_STATES, EXPRESSIONS_USED } from '@tera/character/states';
import type { SkinReport } from '../studio-api';
import { type RawLayer, type RawPoseLayer, layer, removeLayer, setLayerValue, setPoseValue, tree } from './edit';
import type { Store } from './store';

type Child = Node | string;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { dataset?: Record<string, string> } = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  const { dataset, ...rest } = props;
  Object.assign(el, rest);
  if (dataset) Object.assign(el.dataset, dataset);
  el.append(...children);
  return el;
}

const field = (label: string, control: Node, title?: string) => {
  const f = h('label', { className: 'field' }, h('span', { textContent: label }), control);
  if (title) f.title = title;
  return f;
};

function numberInput(value: number | undefined, onCommit: (v: number | undefined) => void, step = 1, placeholder = ''): HTMLInputElement {
  const input = h('input', { type: 'number', step: String(step), placeholder });
  if (value !== undefined) input.value = String(value);
  input.onchange = () => onCommit(input.value === '' ? undefined : Number(input.value));
  return input;
}

function pairInput(value: [number, number] | undefined, onCommit: (v: [number, number]) => void, step = 1): HTMLElement {
  const [x, y] = value ?? [0, 0];
  const a = numberInput(x, (v) => onCommit([v ?? 0, Number(b.value) || 0]), step);
  const b = numberInput(y, (v) => onCommit([Number(a.value) || 0, v ?? 0]), step);
  return h('div', { className: 'pair' }, a, b);
}

/** Controle deslizante + número (rotação, deslocamento...) */
function slider(value: number, min: number, max: number, step: number, onInput: (v: number) => void, onCommit: (v: number) => void): HTMLElement {
  const range = h('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(value) });
  const num = h('input', { type: 'number', step: String(step), value: String(value) });
  range.oninput = () => {
    num.value = range.value;
    onInput(Number(range.value));
  };
  range.onchange = () => onCommit(Number(range.value));
  num.onchange = () => onCommit(Number(num.value));
  return h('div', { className: 'slider' }, range, num);
}

function select(options: [string, string][], value: string, onChange: (v: string) => void): HTMLSelectElement {
  const s = h('select');
  for (const [v, label] of options) s.append(h('option', { value: v, textContent: label }));
  s.value = value;
  s.onchange = () => onChange(s.value);
  return s;
}

// ---------- Camada ----------

function layerTab(store: Store): Node[] {
  const id = store.selected;
  const l = id ? layer(store.raw, id) : undefined;
  if (!l) return [h('p', { className: 'empty', textContent: 'Escolha uma camada na lista ou clique na figura.' })];
  const set = (key: string, value: unknown) => store.commit(setLayerValue(store.raw, l.id, key, value));
  const files: [string, string][] = store.files.map((f) => [f.path, `${f.path} (${f.width}×${f.height})`]);
  const others = tree(store.raw).map(({ layer: x, depth }) => x).filter((x) => x.id !== l.id && !isDescendant(store, x.id, l.id));
  const scale = typeof l.scale === 'number' ? [l.scale, l.scale] as [number, number] : l.scale ?? [1, 1];

  const variants = h('div', { className: 'variants' });
  for (const [name, file] of Object.entries(l.variants ?? {})) {
    const rm = h('button', { type: 'button', textContent: '×', title: `Tirar a variante ${name}` });
    rm.onclick = () => {
      const next = { ...(l.variants ?? {}) };
      delete next[name];
      set('variants', Object.keys(next).length ? next : undefined);
    };
    variants.append(h('div', { className: 'variant-row' },
      h('code', { textContent: name }),
      select(files, file, (v) => set('variants', { ...(l.variants ?? {}), [name]: v })),
      rm));
  }
  const addVariant = h('button', { type: 'button', textContent: '+ variante' });
  addVariant.onclick = () => {
    const name = prompt('Nome da variante (ex.: closed, open, happy):')?.trim();
    if (!name || !/^[a-z0-9][a-z0-9_-]{0,39}$/i.test(name) || name === 'default') return;
    set('variants', { ...(l.variants ?? {}), [name]: l.image });
  };

  const remove = h('button', { type: 'button', className: 'danger', textContent: 'Remover camada', disabled: !l.parent });
  remove.onclick = () => {
    if (!confirm(`Remover a camada "${l.id}"? Os filhos passam pro pai dela.`)) return;
    store.commit(removeLayer(store.raw, l.id));
    store.select(l.parent ?? null);
  };

  return [
    h('div', { className: 'group' },
      h('h3', { textContent: l.id }),
      field('Imagem', select(files, l.image, (v) => set('image', v))),
      field('Pai', select([['', '— raiz —'], ...others.map((x): [string, string] => [x.id, x.id])], l.parent ?? '', (v) => set('parent', v || null))),
      field('Na frente (z)', numberInput(l.z ?? 0, (v) => set('z', v ?? 0)), 'Maior = desenhado na frente'),
      field('Visível', checkbox(l.visible !== false, (v) => set('visible', v ? undefined : false))),
    ),
    h('div', { className: 'group' },
      h('h3', { textContent: 'Repouso' }),
      field('Pivô', pairInput(l.pivot, (v) => set('pivot', v)), 'Ponto de giro, em px da imagem (Alt + arrastar na figura)'),
      field('Posição', pairInput(l.at, (v) => set('at', v)), 'Onde o pivô fica, em px da imagem do pai (arrastar na figura)'),
      field('Rotação', slider(l.rotation ?? 0, -180, 180, 1, (v) => store.live(setLayerValue(store.raw, l.id, 'rotation', v || undefined)), (v) => set('rotation', v || undefined))),
      field('Escala', pairInput(scale, (v) => set('scale', v[0] === 1 && v[1] === 1 ? undefined : v[0] === v[1] ? v[0] : v), 0.05)),
    ),
    h('div', { className: 'group' }, h('h3', { textContent: 'Variantes (mesmo tamanho da imagem)' }), variants, addVariant),
    remove,
  ];
}

function isDescendant(store: Store, id: string, ancestor: string): boolean {
  let cur = layer(store.raw, id);
  const seen = new Set<string>();
  while (cur?.parent && !seen.has(cur.id)) {
    if (cur.parent === ancestor) return true;
    seen.add(cur.id);
    cur = layer(store.raw, cur.parent);
  }
  return false;
}

function checkbox(checked: boolean, onChange: (v: boolean) => void): HTMLInputElement {
  const c = h('input', { type: 'checkbox', checked });
  c.onchange = () => onChange(c.checked);
  return c;
}

// ---------- Poses ----------

const STATES_BY_POSE = (pose: string) => CHARACTER_STATES.filter((s) => s.pose === pose).map((s) => s.label);

function poseTab(store: Store): Node[] {
  const defined = Object.keys(store.raw.poses ?? {});
  const names = [...new Set([...POSES, ...defined])];
  const label = (p: string) => {
    const used = STATES_BY_POSE(p);
    const mark = defined.includes(p) ? '' : ' (vazia)';
    return `${p}${mark}${used.length ? ` — ${used.join(', ')}` : ''}`;
  };
  const pick = select(names.map((p): [string, string] => [p, label(p)]), store.pose, (v) => store.set('pose', v));
  const addPose = h('button', { type: 'button', textContent: '+ pose' });
  addPose.onclick = () => {
    const name = prompt('Nome da pose nova:')?.trim();
    if (!name || !/^[a-z0-9][a-z0-9_-]{0,39}$/i.test(name)) return;
    store.commit({ ...store.raw, poses: { ...(store.raw.poses ?? {}), [name]: { layers: {} } } });
    store.set('pose', name);
  };
  const out: Node[] = [
    h('div', { className: 'row' }, pick, addPose),
    h('p', { className: 'hint', textContent: 'A pose soma ajustes ao repouso de cada camada. Arraste a camada na figura pra mexer nela nesta pose; a roda do mouse gira.' }),
  ];
  const id = store.selected;
  const l = id ? layer(store.raw, id) : undefined;
  if (!l) {
    out.push(h('p', { className: 'empty', textContent: 'Escolha uma camada pra ajustar nesta pose.' }));
  } else {
    const cur: RawPoseLayer = store.raw.poses?.[store.pose]?.layers[l.id] ?? {};
    const set = (key: keyof RawPoseLayer, v: number | string | boolean | undefined) => store.commit(setPoseValue(store.raw, store.pose, l.id, key, v));
    const live = (key: keyof RawPoseLayer, v: number) => store.live(setPoseValue(store.raw, store.pose, l.id, key, v));
    const variantNames: [string, string][] = [['default', 'padrão'], ...Object.keys(l.variants ?? {}).map((v): [string, string] => [v, v])];
    out.push(h('div', { className: 'group' },
      h('h3', { textContent: `${l.id} em "${store.pose}"` }),
      field('Rotação', slider(cur.rotation ?? 0, -180, 180, 1, (v) => live('rotation', v), (v) => set('rotation', v))),
      field('Desloca X', slider(cur.dx ?? 0, -200, 200, 1, (v) => live('dx', v), (v) => set('dx', v))),
      field('Desloca Y', slider(cur.dy ?? 0, -200, 200, 1, (v) => live('dy', v), (v) => set('dy', v))),
      field('Escala X', slider(cur.scaleX ?? 1, 0.2, 2, 0.01, (v) => live('scaleX', v), (v) => set('scaleX', v))),
      field('Escala Y', slider(cur.scaleY ?? 1, 0.2, 2, 0.01, (v) => live('scaleY', v), (v) => set('scaleY', v))),
      field('Variante', select(variantNames, cur.variant ?? 'default', (v) => set('variant', v))),
      field('Visível', select([['', 'como no repouso'], ['true', 'mostra'], ['false', 'esconde']], cur.visible === undefined ? '' : String(cur.visible), (v) => set('visible', v === '' ? undefined : v === 'true'))),
    ));
  }
  const clear = h('button', { type: 'button', className: 'danger', textContent: `Apagar a pose "${store.pose}"`, disabled: !defined.includes(store.pose) });
  clear.onclick = () => {
    if (!confirm(`Apagar a pose "${store.pose}"? Os estados que usam ela caem no idle.`)) return;
    const poses = { ...(store.raw.poses ?? {}) };
    delete poses[store.pose];
    store.commit({ ...store.raw, poses });
  };
  out.push(clear);
  return out;
}

// ---------- Expressões ----------

function exprTab(store: Store): Node[] {
  const defined = Object.keys(store.raw.expressions ?? {});
  const names = [...new Set([...EXPRESSIONS_USED.filter((e) => e !== 'neutral'), ...defined])];
  const pick = select(names.map((e): [string, string] => [e, defined.includes(e) ? e : `${e} (vazia)`]), store.expression, (v) => store.set('expression', v));
  const addExpr = h('button', { type: 'button', textContent: '+ expressão' });
  addExpr.onclick = () => {
    const name = prompt('Nome da expressão nova:')?.trim();
    if (!name || !/^[a-z0-9][a-z0-9_-]{0,39}$/i.test(name)) return;
    store.commit({ ...store.raw, expressions: { ...(store.raw.expressions ?? {}), [name]: {} } });
    store.set('expression', name);
  };
  const expr = store.raw.expressions?.[store.expression] ?? {};
  const rows: Node[] = [];
  for (const l of store.raw.layers.filter((x: RawLayer) => Object.keys(x.variants ?? {}).length)) {
    const opts: [string, string][] = [['', '— como está —'], ['default', 'padrão'], ...Object.keys(l.variants ?? {}).map((v): [string, string] => [v, v])];
    rows.push(field(l.id, select(opts, expr[l.id] ?? '', (v) => {
      const next = { ...expr };
      if (v) next[l.id] = v;
      else delete next[l.id];
      store.commit({ ...store.raw, expressions: { ...(store.raw.expressions ?? {}), [store.expression]: next } });
    })));
  }
  return [
    h('div', { className: 'row' }, pick, addExpr),
    h('p', { className: 'hint', textContent: 'Uma expressão troca a variante de algumas camadas (olhos, boca) por cima da pose. Só aparecem as camadas que têm variantes.' }),
    rows.length ? h('div', { className: 'group' }, ...rows) : h('p', { className: 'empty', textContent: 'Nenhuma camada com variantes ainda (aba Camada → + variante).' }),
  ];
}

// ---------- Movimentos ----------

function ctrlTab(store: Store, toast: (msg: string, kind?: 'error') => void): Node[] {
  const text = h('textarea', { spellcheck: false, value: JSON.stringify(store.raw.controllers ?? {}, null, 2) });
  text.style.minHeight = '260px';
  const apply = h('button', { type: 'button', className: 'primary', textContent: 'Aplicar' });
  apply.onclick = () => {
    try {
      const controllers = JSON.parse(text.value) as Record<string, unknown>;
      store.commit({ ...store.raw, controllers });
    } catch (err) {
      toast(`JSON inválido: ${(err as Error).message}`, 'error');
    }
  };
  return [
    h('div', { className: 'group' },
      h('h3', { textContent: 'Pés e canvas' }),
      field('Pés', pairInput(store.raw.feet ?? [store.raw.canvas / 2, store.raw.canvas], (v) => store.commit({ ...store.raw, feet: v })), 'Âncora do corpo inteiro (respirar, quicar, arrastar)'),
      field('Canvas', numberInput(store.raw.canvas, (v) => v && store.commit({ ...store.raw, canvas: v })), 'Lado do canvas do rig, em px'),
    ),
    h('p', { className: 'hint', textContent: 'Movimentos automáticos: breathe (respirar), sway (cauda/cabelo), blink (piscar), gaze (olhar), talk (boca), walk (passos). O formato está no rig.schema.json; teste no modo Testar.' }),
    text,
    h('div', { className: 'row' }, apply),
  ];
}

// ---------- Conferir ----------

function reportTab(report: SkinReport | null): Node[] {
  if (!report) return [h('p', { className: 'empty', textContent: 'Conferindo…' })];
  const out: Node[] = [h('p', { textContent: report.ok ? '✓ A Tera carrega esta skin.' : '✗ A Tera não carregaria esta skin (e não dá pra salvar assim).' })];
  if (report.errors.length) out.push(h('h2', { textContent: 'Erros' }), h('ul', { className: 'report-list errors' }, ...report.errors.map((e) => h('li', { textContent: e }))));
  if (report.warnings.length) out.push(h('h2', { textContent: 'Avisos' }), h('ul', { className: 'report-list warnings' }, ...report.warnings.map((w) => h('li', { textContent: w }))));
  out.push(h('p', { className: 'hint', textContent: 'Pra conferir tudo de uma vez: tera-skin render <pasta> gera a folha de conferência (previews/folha.png).' }));
  return out;
}

export function renderInspector(store: Store, report: SkinReport | null, toast: (msg: string, kind?: 'error') => void): void {
  const tabs: Record<string, () => Node[]> = {
    layer: () => layerTab(store),
    pose: () => poseTab(store),
    expr: () => exprTab(store),
    ctrl: () => ctrlTab(store, toast),
    report: () => reportTab(report),
  };
  for (const b of document.querySelectorAll<HTMLButtonElement>('#tabs button')) b.setAttribute('aria-selected', String(b.dataset.tab === store.tab));
  for (const t of ['layer', 'pose', 'expr', 'ctrl', 'json', 'report']) document.getElementById(`tab-${t}`)!.hidden = t !== store.tab;
  const fill = tabs[store.tab];
  // não refaz o painel enquanto alguém digita ou arrasta um controle dele
  const box = document.getElementById(`tab-${store.tab}`)!;
  const typing = box.contains(document.activeElement) && document.activeElement?.matches('input[type="range"], input[type="number"], input[type="text"], textarea');
  if (fill && !typing) box.replaceChildren(...fill());
}
