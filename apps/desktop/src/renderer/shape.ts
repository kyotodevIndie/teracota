// Recorte da janela da Tera (Linux): só a área da personagem recebe cliques, o resto da
// janela transparente deixa passar. No XWayland o app só sabe onde está o mouse quando ele
// está em cima de uma janela X11, então o truque do Windows (ignorar o mouse e reativar ao
// passar em cima) nunca reativaria; o recorte resolve sem depender da posição do cursor.

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Retângulos que cobrem os pontos onde `hit` é verdadeiro, numa grade de `cell` px, com
 * folga `pad` em volta (a pose muda entre um recálculo e outro). Junta células vizinhas da
 * mesma linha e linhas iguais seguidas, pra mandar poucos retângulos.
 */
export function rectsFromGrid(hit: (x: number, y: number) => boolean, area: Rect, cell: number, pad: number): Rect[] {
  const rows: { y: number; runs: [number, number][] }[] = [];
  for (let y = area.y; y < area.y + area.height; y += cell) {
    const runs: [number, number][] = [];
    let start: number | null = null;
    for (let x = area.x; x < area.x + area.width; x += cell) {
      const inside = hit(x + cell / 2, y + cell / 2);
      if (inside && start === null) start = x;
      if (!inside && start !== null) {
        runs.push([start, x]);
        start = null;
      }
    }
    if (start !== null) runs.push([start, area.x + area.width]);
    rows.push({ y, runs });
  }
  // linhas seguidas com os mesmos trechos viram um retângulo só
  const out: Rect[] = [];
  let open: { runs: [number, number][]; y0: number; y1: number } | null = null;
  const flush = () => {
    if (!open) return;
    for (const [x0, x1] of open.runs) out.push({ x: x0, y: open.y0, width: x1 - x0, height: open.y1 - open.y0 });
    open = null;
  };
  for (const r of rows) {
    const same = open && open.runs.length === r.runs.length && open.runs.every(([a, b], i) => a === r.runs[i]![0] && b === r.runs[i]![1]);
    if (same) open!.y1 = r.y + cell;
    else {
      flush();
      if (r.runs.length) open = { runs: r.runs, y0: r.y, y1: r.y + cell };
    }
  }
  flush();
  return out.map((r) => padRect(r, pad));
}

export function padRect(r: Rect, pad: number): Rect {
  return { x: Math.floor(r.x - pad), y: Math.floor(r.y - pad), width: Math.ceil(r.width + pad * 2), height: Math.ceil(r.height + pad * 2) };
}

/** Prende os retângulos dentro da janela e descarta os vazios */
export function clipRects(rects: Rect[], width: number, height: number): Rect[] {
  return rects.map((r) => {
    const x = Math.max(0, r.x);
    const y = Math.max(0, r.y);
    return { x, y, width: Math.min(width, r.x + r.width) - x, height: Math.min(height, r.y + r.height) - y };
  }).filter((r) => r.width > 0 && r.height > 0);
}
