// A janela da interface é do tamanho do conteúdo e fica presa na Tera: aqui se mede a
// altura e onde estão os cartões (no Linux o resto da janela deixa o clique passar), e se
// aplica o que o main decidiu (em cima/embaixo, onde a pontinha aponta, altura máxima).
import type { AppPanelApi, LayoutRect } from '../shared/app-panel';
import type { PanelPlacement } from '../shared/live';

const MAX_RECTS = 60;
const PAD = 3;

/** Retângulos dos elementos que recebem clique (os .hit visíveis), com uma folga */
export function hitRects(nodes: Iterable<Element>, maxRects = MAX_RECTS): LayoutRect[] {
  const out: LayoutRect[] = [];
  for (const n of nodes) {
    const r = n.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    out.push({ x: Math.floor(r.left - PAD), y: Math.floor(r.top - PAD), width: Math.ceil(r.width + PAD * 2), height: Math.ceil(r.height + PAD * 2) });
  }
  if (out.length <= maxRects) return out;
  // cartões demais: um retângulo só, cobrindo todos
  const x0 = Math.min(...out.map((r) => r.x));
  const y0 = Math.min(...out.map((r) => r.y));
  const x1 = Math.max(...out.map((r) => r.x + r.width));
  const y1 = Math.max(...out.map((r) => r.y + r.height));
  return [{ x: x0, y: y0, width: x1 - x0, height: y1 - y0 }];
}

export function mountLayout(api: AppPanelApi, onPlacement: (p: PanelPlacement) => void): { changed(): void } {
  const root = document.getElementById('root')!;
  const full = document.getElementById('full')!;
  const peek = document.getElementById('peek')!;
  let placement: PanelPlacement | null = null;
  let queued = false;

  /** Espaço que sobra pra área rolável (a aba aberta) dentro da altura máxima */
  function fitViews(): void {
    if (!placement) return;
    const view = document.querySelector<HTMLElement>('.view:not([hidden])');
    if (!view) return;
    view.style.maxHeight = '';
    const extra = root.scrollHeight - placement.maxHeight;
    if (extra > 0) view.style.maxHeight = `${Math.max(120, view.scrollHeight - extra)}px`;
  }

  function measure(): void {
    queued = false;
    fitViews();
    const visible = [...document.querySelectorAll('.hit')].filter((n) => (n as HTMLElement).offsetParent !== null);
    api.layout(Math.max(1, Math.ceil(root.getBoundingClientRect().height)), hitRects(visible));
  }

  const changed = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(measure);
  };

  api.onPlacement((p) => {
    placement = p;
    root.dataset.side = p.side;
    root.dataset.mode = p.mode;
    root.style.setProperty('--tail-x', `${p.tailX}px`);
    full.hidden = p.mode !== 'full';
    peek.hidden = p.mode !== 'peek';
    onPlacement(p);
    changed();
  });
  new ResizeObserver(changed).observe(root);
  return { changed };
}
