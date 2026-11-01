// Página de render (Electron escondido, `tera-skin render`): desenha a skin em cada
// estado do app, em cada pose e expressão, e quadros do andar e da fala, com o mesmo
// motor da Tera. Devolve cada quadrinho e a folha de conferência em PNG.
import { RigPreview, type PreviewInput } from '@tera/character/preview';
import { RigScene } from '@tera/character/scene';
import { CHARACTER_STATES } from '@tera/character/states';
import type { RenderCell, RenderJob, RenderResult } from '../render-job';

/** Sorteio repetível: a mesma skin sempre gera as mesmas imagens */
function seeded(seed = 7): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Shot {
  group: string;
  file: string;
  label: string;
  /** Entradas em sequência (o último quadro é o que fica): [tempo ms, entrada] */
  steps: [number, PreviewInput][];
}

const WALK_FRAMES = 8;

function shots(job: RenderJob): Shot[] {
  const { rig } = job;
  const base = { facing: job.facing, size: job.size, debug: job.debug };
  const one = (input: PreviewInput): [number, PreviewInput][] => [[0, { ...base, ...input }]];
  const out: Shot[] = [];
  for (const s of CHARACTER_STATES) {
    out.push({ group: 'states', file: s.id, label: s.label, steps: one({ pose: s.pose, expression: s.expression }) });
  }
  for (const pose of Object.keys(rig.poses)) {
    out.push({ group: 'poses', file: pose, label: pose, steps: one({ pose, expression: 'neutral' }) });
  }
  for (const expr of Object.keys(rig.expressions)) {
    out.push({ group: 'expressions', file: expr, label: expr, steps: one({ pose: 'idle', expression: expr }) });
  }
  const blink = rig.controllers.blink;
  if (blink) out.push({ group: 'expressions', file: 'piscando', label: 'piscando', steps: one({ pose: 'idle', expression: 'neutral', variants: { [blink.layer]: blink.closed } }) });
  const walk = rig.controllers.walk;
  const period = walk?.period ?? 560;
  for (let i = 0; i < WALK_FRAMES; i++) {
    const steps: [number, PreviewInput][] = [];
    for (let k = 0; k <= i; k++) steps.push([(k * period) / WALK_FRAMES, { ...base, pose: 'walk', expression: 'neutral', motion: 'walk', dir: 1 }]);
    out.push({ group: 'walk', file: `quadro-${i + 1}`, label: `andando ${i + 1}/${WALK_FRAMES}`, steps });
  }
  const talk = rig.controllers.talk;
  if (talk) {
    talk.variants.forEach((v, i) => {
      out.push({ group: 'talk', file: `boca-${i + 1}`, label: `falando: ${v}`, steps: one({ pose: 'talk', expression: 'neutral', talking: true, variants: { [talk.layer]: v } }) });
    });
  }
  return out;
}

const GROUP_TITLE: Record<string, string> = {
  states: 'Estados do app', poses: 'Poses do rig', expressions: 'Expressões', walk: 'Andando', talk: 'Falando',
};

async function render(job: RenderJob): Promise<RenderResult> {
  const scene = await RigScene.load(job.rig, job.baseUrl, job.cell / job.rig.canvas);
  const cells: RenderCell[] = [];
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = job.cell;
  const ctx = canvas.getContext('2d')!;
  const list = shots(job);
  const images: HTMLCanvasElement[] = [];
  for (const shot of list) {
    const preview = new RigPreview(scene, seeded(), 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, job.cell, job.cell);
    for (const [t, input] of shot.steps) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, job.cell, job.cell);
      preview.draw(ctx, t, input);
    }
    cells.push({ group: shot.group, file: shot.file, label: shot.label, png: canvas.toDataURL('image/png') });
    const copy = document.createElement('canvas');
    copy.width = copy.height = job.cell;
    copy.getContext('2d')!.drawImage(canvas, 0, 0);
    images.push(copy);
  }
  return { cells, sheet: sheet(job, list, images) };
}

/** Folha de conferência: um bloco por grupo, quadrinhos com o nome embaixo */
function sheet(job: RenderJob, list: Shot[], images: HTMLCanvasElement[]): string {
  const PER_ROW = 7;
  const LABEL = 22;
  const TITLE = 34;
  const PAD = 12;
  const cell = job.cell;
  const groups = [...new Set(list.map((s) => s.group))];
  const rows = groups.map((g) => Math.ceil(list.filter((s) => s.group === g).length / PER_ROW));
  const width = PAD * 2 + PER_ROW * cell;
  const height = PAD * 2 + 44 + groups.length * TITLE + rows.reduce((a, r) => a + r * (cell + LABEL), 0);
  const out = document.createElement('canvas');
  out.width = width;
  out.height = height;
  const c = out.getContext('2d')!;
  c.fillStyle = '#f4f1ee';
  c.fillRect(0, 0, width, height);
  c.fillStyle = '#2b2230';
  c.font = '600 20px system-ui, sans-serif';
  c.fillText(`${job.name} — folha de conferência`, PAD, PAD + 24);
  let y = PAD + 44;
  for (const g of groups) {
    c.fillStyle = '#5d5770';
    c.font = '600 15px system-ui, sans-serif';
    c.fillText(GROUP_TITLE[g] ?? g, PAD, y + 22);
    y += TITLE;
    const items = list.map((s, i) => [s, i] as const).filter(([s]) => s.group === g);
    items.forEach(([s, i], k) => {
      const x = PAD + (k % PER_ROW) * cell;
      const yy = y + Math.floor(k / PER_ROW) * (cell + LABEL);
      // fundo xadrez discreto: mostra o que é transparente
      for (let gy = 0; gy < cell; gy += 16) for (let gx = 0; gx < cell; gx += 16) {
        c.fillStyle = (gx + gy) % 32 === 0 ? '#ffffff' : '#ece8e4';
        c.fillRect(x + gx, yy + gy, 16, 16);
      }
      // linha dos pés
      const feetY = yy + (job.rig.feet[1] / job.rig.canvas) * cell;
      c.strokeStyle = 'rgba(200, 98, 58, 0.35)';
      c.beginPath();
      c.moveTo(x + 4, feetY);
      c.lineTo(x + cell - 4, feetY);
      c.stroke();
      c.drawImage(images[i]!, x, yy);
      c.fillStyle = '#2b2230';
      c.font = '12px system-ui, sans-serif';
      c.fillText(s.label, x + 6, yy + cell + 15, cell - 12);
    });
    y += Math.ceil(items.length / PER_ROW) * (cell + LABEL);
  }
  return out.toDataURL('image/png');
}

declare global {
  interface Window {
    teraRender(job: RenderJob): Promise<RenderResult>;
  }
}

window.teraRender = render;
