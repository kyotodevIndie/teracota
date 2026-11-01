// Um chip por IA no topo (a % da janela mais apertada). Mouse em cima (ou foco/clique)
// abre o balão só daquela IA, com cada limite, a barra e quando reinicia.
import type { ProviderUsage } from '../shared/live';
import { WINDOW_LABEL, chipPct, resetText, usageLevel } from './panel-format';
import { aiIcon } from './panel-live';

const CLOSE_DELAY_MS = 220;

export function mountUsage(opts: { changed(): void }): { render(list: ProviderUsage[]): void } {
  const chips = document.getElementById('chips')!;
  const pop = document.getElementById('usage-pop')!;
  let list: ProviderUsage[] = [];
  let openFor: string | null = null;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;

  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };

  function renderPop(): void {
    const u = list.find((p) => p.provider === openFor);
    pop.hidden = !u;
    for (const c of chips.children) c.setAttribute('aria-expanded', String((c as HTMLElement).dataset.provider === openFor));
    if (!u) {
      opts.changed();
      return;
    }
    const head = el('div', 'pop-head');
    head.append(aiIcon(u.badge), el('strong', undefined, u.displayName));
    const rows = u.windows.map((w) => {
      const pct = Math.round(w.usedPct);
      const meter = el('div', 'meter');
      meter.dataset.level = usageLevel(w.usedPct);
      const row = el('div', 'meter-row');
      row.append(el('span', undefined, WINDOW_LABEL[w.id]), el('span', 'when', resetText(w.resetsAt)), el('span', 'pct', `${pct}%`));
      const bar = el('div', 'bar');
      bar.setAttribute('role', 'progressbar');
      bar.setAttribute('aria-label', WINDOW_LABEL[w.id]);
      bar.setAttribute('aria-valuenow', String(pct));
      bar.setAttribute('aria-valuemin', '0');
      bar.setAttribute('aria-valuemax', '100');
      const fill = el('span');
      fill.style.width = `${Math.min(100, pct)}%`;
      bar.append(fill);
      meter.append(row, bar);
      return meter;
    });
    pop.replaceChildren(head, ...rows);
    opts.changed();
  }

  const open = (provider: string) => {
    clearTimeout(closeTimer);
    if (openFor === provider) return;
    openFor = provider;
    renderPop();
  };
  const closeSoon = () => {
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
      openFor = null;
      renderPop();
    }, CLOSE_DELAY_MS);
  };
  pop.addEventListener('mouseenter', () => clearTimeout(closeTimer));
  pop.addEventListener('mouseleave', closeSoon);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && openFor) {
      openFor = null;
      renderPop();
      e.stopPropagation();
    }
  }, true);

  return {
    render(next) {
      list = next;
      chips.replaceChildren(...next.map((u) => {
        const pct = Math.round(chipPct(u));
        const chip = el('button', 'chip glass');
        chip.type = 'button';
        chip.dataset.provider = u.provider;
        chip.dataset.level = usageLevel(pct);
        chip.dataset.testid = `usage-${u.provider}`;
        chip.setAttribute('aria-label', `Uso do ${u.displayName}: ${pct}%`);
        chip.setAttribute('aria-haspopup', 'dialog');
        chip.append(aiIcon(u.badge), `${pct}%`);
        chip.onmouseenter = () => open(u.provider);
        chip.onmouseleave = closeSoon;
        chip.onfocus = () => open(u.provider);
        chip.onblur = closeSoon;
        chip.onclick = () => {
          if (openFor === u.provider) {
            openFor = null;
            renderPop();
          } else open(u.provider);
        };
        return chip;
      }));
      if (openFor && !next.some((u) => u.provider === openFor)) openFor = null;
      renderPop();
    },
  };
}
