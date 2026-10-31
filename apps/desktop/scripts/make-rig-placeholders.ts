// Gera as camadas PROVISÓRIAS do rig (formas geométricas com hachura), em
// assets/skins/tera-rig/parts/ na raiz do monorepo. Servem pra desenvolver e testar o
// motor (poses, expressões, piscada, boca); NÃO são a arte final da Tera.
//   node build.mjs && node dist/scripts/make-rig-placeholders.js
//
// Sem dependências: rasteriza as formas com supersampling e grava PNG com o zlib do Node.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

type Rgb = [number, number, number];
type Shape = 'rounded' | 'ellipse' | 'triangle' | 'ink';

interface Part {
  file: string;
  w: number;
  h: number;
  shape: Shape;
  fill: Rgb;
  /** raio dos cantos (rounded) */
  radius?: number;
  /** shape 'ink': só traço escuro onde a função diz (olhos, boca); o resto é transparente */
  ink?: (x: number, y: number, w: number, h: number) => boolean;
}

// ---------- olhos e boca (variantes) ----------

const EYE_X = [0.27, 0.73];
const dot = (r: number) => (x: number, y: number, w: number, h: number) => EYE_X.some((cx) => Math.hypot(x - w * cx, y - h / 2) < r);
/** arco de circunferência (traço) centrado em (cx, cy); up = parte de cima do círculo */
const arc = (x: number, y: number, cx: number, cy: number, r: number, up: boolean, t = 2) =>
  Math.abs(Math.hypot(x - cx, y - cy) - r) < t && (up ? y < cy : y > cy);
const EYES = {
  'eyes.png': dot(9),
  'eyes_wide.png': dot(12),
  'eyes_closed.png': (x: number, y: number, w: number, h: number) => EYE_X.some((cx) => Math.abs(x - w * cx) < 10 && Math.abs(y - h / 2) < 2),
  'eyes_happy.png': (x: number, y: number, w: number, h: number) => EYE_X.some((cx) => arc(x, y, w * cx, h * 0.62, 9, true)),
};
const MOUTHS = {
  'mouth.png': (x: number, y: number, w: number, h: number) => Math.abs(x - w / 2) < 9 && Math.abs(y - h / 2) < 2,
  'mouth_open.png': (x: number, y: number, w: number, h: number) => Math.hypot((x - w / 2) / 8, (y - h / 2) / 6) < 1,
  'mouth_smile.png': (x: number, y: number, w: number, h: number) => arc(x, y, w / 2, h * 0.15, 11, false),
  'mouth_frown.png': (x: number, y: number, w: number, h: number) => arc(x, y, w / 2, h * 0.95, 11, true),
};

// Paleta próxima da Tera atual (moletom terracota, cabelo ruivo, pele clara)
const HOODIE: Rgb = [200, 100, 60];
const HAIR: Rgb = [180, 83, 47];
const SKIN: Rgb = [255, 227, 211];
const SHOE: Rgb = [92, 52, 38];
const INK: Rgb = [43, 34, 48];

const PARTS: Part[] = [
  { file: 'body.png', w: 150, h: 170, shape: 'rounded', fill: HOODIE, radius: 46 },
  { file: 'arm_l.png', w: 40, h: 116, shape: 'rounded', fill: HOODIE, radius: 18 },
  { file: 'arm_r.png', w: 40, h: 116, shape: 'rounded', fill: HOODIE, radius: 18 },
  { file: 'hand_l.png', w: 34, h: 34, shape: 'ellipse', fill: SKIN },
  { file: 'hand_r.png', w: 34, h: 34, shape: 'ellipse', fill: SKIN },
  { file: 'leg_l.png', w: 44, h: 84, shape: 'rounded', fill: SKIN, radius: 16 },
  { file: 'leg_r.png', w: 44, h: 84, shape: 'rounded', fill: SKIN, radius: 16 },
  { file: 'shoe_l.png', w: 56, h: 30, shape: 'rounded', fill: SHOE, radius: 14 },
  { file: 'shoe_r.png', w: 56, h: 30, shape: 'rounded', fill: SHOE, radius: 14 },
  { file: 'head.png', w: 210, h: 190, shape: 'ellipse', fill: HAIR },
  { file: 'face.png', w: 150, h: 112, shape: 'ellipse', fill: SKIN },
  ...Object.entries(EYES).map(([file, ink]): Part => ({ file, w: 110, h: 30, shape: 'ink', fill: INK, ink })),
  ...Object.entries(MOUTHS).map(([file, ink]): Part => ({ file, w: 40, h: 24, shape: 'ink', fill: INK, ink })),
  { file: 'ear_l.png', w: 64, h: 76, shape: 'triangle', fill: HAIR },
  { file: 'ear_r.png', w: 64, h: 76, shape: 'triangle', fill: HAIR },
  { file: 'tail_1.png', w: 30, h: 78, shape: 'rounded', fill: HAIR, radius: 14 },
  { file: 'tail_2.png', w: 28, h: 74, shape: 'rounded', fill: HAIR, radius: 13 },
  { file: 'tail_3.png', w: 26, h: 70, shape: 'rounded', fill: HAIR, radius: 12 },
];

const SS = 4; // supersampling por eixo
const OUTLINE = 5;

/** Distância com sinal até a borda da forma (negativo = dentro), em px */
function sdf(shape: Exclude<Shape, 'ink'>, w: number, h: number, x: number, y: number, radius = 0): number {
  if (shape === 'ellipse') {
    const rx = w / 2 - 1;
    const ry = h / 2 - 1;
    const nx = (x - w / 2) / rx;
    const ny = (y - h / 2) / ry;
    return (Math.hypot(nx, ny) - 1) * Math.min(rx, ry);
  }
  if (shape === 'triangle') {
    // ponta pra cima: (w/2, 1), base de (1, h-1) a (w-1, h-1)
    const edges: [number, number, number, number][] = [[w / 2, 1, w - 1, h - 1], [w - 1, h - 1, 1, h - 1], [1, h - 1, w / 2, 1]];
    let d = -Infinity;
    for (const [ax, ay, bx, by] of edges) {
      const nx = by - ay;
      const ny = ax - bx;
      const len = Math.hypot(nx, ny);
      d = Math.max(d, ((x - ax) * nx + (y - ay) * ny) / len);
    }
    return d;
  }
  const r = Math.min(radius, w / 2 - 1, h / 2 - 1);
  const qx = Math.abs(x - w / 2) - (w / 2 - 1 - r);
  const qy = Math.abs(y - h / 2) - (h / 2 - 1 - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

function render(p: Part): Buffer {
  const px = Buffer.alloc(p.w * p.h * 4);
  for (let y = 0; y < p.h; y++) {
    for (let x = 0; x < p.w; x++) {
      let cover = 0;
      let ink = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const fx = x + (sx + 0.5) / SS;
          const fy = y + (sy + 0.5) / SS;
          if (p.ink) {
            if (p.ink(fx, fy, p.w, p.h)) { cover++; ink++; }
            continue;
          }
          const d = sdf(p.shape as Exclude<Shape, 'ink'>, p.w, p.h, fx, fy, p.radius);
          if (d > 0) continue;
          cover++;
          if (d > -OUTLINE) ink++;
        }
      }
      const i = (y * p.w + x) * 4;
      if (!cover) continue;
      // hachura diagonal leve: deixa claro que é provisório
      const hatch = p.ink || (x + y) % 14 >= 2 ? 1 : 0.88;
      const t = ink / cover;
      for (let c = 0; c < 3; c++) px[i + c] = Math.round((p.fill[c]! * hatch) * (1 - t) + INK[c]! * t);
      px[i + 3] = Math.round((cover / (SS * SS)) * 255);
    }
  }
  return encodePng(p.w, p.h, px);
}

// ---------- PNG (RGBA 8 bits) ----------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(w: number, h: number, rgba: Buffer): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bits
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const outDir = path.resolve(__dirname, '..', '..', '..', '..', 'assets', 'skins', 'tera-rig', 'parts'); // dist/scripts → raiz
fs.mkdirSync(outDir, { recursive: true });
for (const p of PARTS) fs.writeFileSync(path.join(outDir, p.file), render(p));
console.log(`[rig] ${PARTS.length} camadas provisórias em ${outDir}`);
