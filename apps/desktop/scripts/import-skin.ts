// Importa um pacote de sprites (formato desktop-pet-sprite-pack-v1, gerado pelo GPT)
// como skin do app.
//
//   npm run import-skin -- <pasta-do-pacote> <id> [nome]
//   npm run import-skin -- ./sprite-pack-final tera "Tera"
import fs from 'node:fs';
import path from 'node:path';
import { POSES, type Pose, type SkinManifest } from '@tera/character/skin';

interface PackAnimation {
  frames: string[];
  frame_durations_ms?: number[];
}

interface PackManifest {
  format?: string;
  primary_drag_variant?: string;
  animations: Record<string, PackAnimation>;
}

/** Animações que tocam uma vez só */
const ONE_SHOT: Pose[] = ['land'];
/** Tamanho na tela do frame de 512px (≈ mesma altura do personagem SVG) */
const DISPLAY_SIZE = 260;

const [packArg, id, name] = process.argv.slice(2);
if (!packArg || !id) {
  console.error('uso: pnpm import-skin <pasta-do-pacote> <id> [nome]');
  process.exit(1);
}
if (!/^[a-z0-9-]+$/.test(id)) {
  console.error('id deve ter só letras minúsculas, números e hífen');
  process.exit(1);
}

// rodando via `pnpm import-skin` (na raiz) o cwd é apps/desktop: caminhos relativos são de onde o comando foi chamado
const packDir = path.resolve(process.env.INIT_CWD ?? process.cwd(), packArg);
const pack = JSON.parse(fs.readFileSync(path.join(packDir, 'manifest.json'), 'utf8')) as PackManifest;
const outDir = path.resolve(__dirname, '..', '..', '..', '..', 'assets', 'skins', id); // dist/scripts → raiz do monorepo
fs.rmSync(outDir, { recursive: true, force: true });

const manifest: SkinManifest = { name: name ?? id, size: DISPLAY_SIZE, facing: 'right', animations: {} };

for (const pose of POSES) {
  const anim = pack.animations[pose];
  if (!anim) continue;
  const frames = anim.frames.map((src, i) => {
    const rel = `frames/${pose}/${String(i + 1).padStart(2, '0')}.png`;
    fs.mkdirSync(path.join(outDir, 'frames', pose), { recursive: true });
    fs.copyFileSync(path.join(packDir, src), path.join(outDir, rel));
    return rel;
  });
  manifest.animations[pose] = {
    frames,
    durations: anim.frame_durations_ms ?? frames.map(() => 150),
    ...(ONE_SHOT.includes(pose) && { loop: false }),
  };
}

fs.writeFileSync(path.join(outDir, 'skin.json'), JSON.stringify(manifest, null, 2));
const found = Object.keys(manifest.animations);
const missing = POSES.filter((p) => !found.includes(p));
console.log(`skin "${manifest.name}" → ${path.relative(process.cwd(), outDir)}`);
console.log(`  animações: ${found.join(', ')}`);
if (missing.length) console.log(`  faltando (usa fallback): ${missing.join(', ')}`);
