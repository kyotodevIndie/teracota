// Confere uma pasta de skin de rig inteira, além do que o app já valida ao carregar:
// arquivos que faltam, variantes de tamanho diferente da imagem padrão, PNGs que nenhuma
// camada usa e quais estados do app vão cair no repouso por falta de pose ou expressão.
// Erro = a Tera não carrega a skin; aviso = carrega, mas algo vai ficar estranho.
import fs from 'node:fs';
import path from 'node:path';
import { type RigManifest, parseRigManifest } from '@tera/character/rig';
import { POSES, parseSkinManifest } from '@tera/character/skin';
import { CHARACTER_STATES, EXPRESSIONS_USED } from '@tera/character/states';
import { pngSize } from './png';

export interface SkinReport {
  ok: boolean;
  errors: string[];
  warnings: string[];
  /** O rig validado (quando não há erro no rig.json) */
  rig?: RigManifest;
  /** Caminho do rig.json, relativo à pasta da skin */
  rigFile?: string;
  name?: string;
}

/** Poses que o app pede em movimento e na aterrissagem, além das dos estados */
const MOTION_POSES = ['walk', 'drag', 'land'];

const readJson = (file: string): unknown => JSON.parse(fs.readFileSync(file, 'utf8'));

/** Todos os PNGs da pasta (caminhos relativos com /) */
function listPngs(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listPngs(full, base));
    else if (entry.name.toLowerCase().endsWith('.png')) out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}

/**
 * Valida a pasta de uma skin de rig. `rigOverride` valida um rig ainda não salvo (o Studio
 * manda o que está na tela) contra os arquivos da pasta.
 */
export function validateSkinDir(dir: string, rigOverride?: unknown): SkinReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const skinFile = path.join(dir, 'skin.json');
  if (!fs.existsSync(skinFile)) return { ok: false, errors: ['skin.json não encontrado na pasta'], warnings };
  let manifestRaw: unknown;
  try {
    manifestRaw = readJson(skinFile);
  } catch (err) {
    return { ok: false, errors: [`skin.json não é um JSON válido: ${(err as Error).message}`], warnings };
  }
  const manifest = parseSkinManifest(manifestRaw);
  if (!manifest) return { ok: false, errors: ['skin.json inválido (veja docs/dev/skins.md)'], warnings };
  if (manifest.type !== 'rig' || !manifest.rig) {
    return { ok: false, errors: ['esta skin não é de rig ("type": "rig" e "rig": "rig.json" no skin.json)'], warnings, name: manifest.name };
  }

  let rigRaw = rigOverride;
  if (rigRaw === undefined) {
    const rigFile = path.join(dir, manifest.rig);
    if (!fs.existsSync(rigFile)) return { ok: false, errors: [`${manifest.rig} não encontrado`], warnings, name: manifest.name, rigFile: manifest.rig };
    try {
      rigRaw = readJson(rigFile);
    } catch (err) {
      return { ok: false, errors: [`${manifest.rig} não é um JSON válido: ${(err as Error).message}`], warnings, name: manifest.name, rigFile: manifest.rig };
    }
  }
  const parsed = parseRigManifest(rigRaw);
  if (!parsed.rig) return { ok: false, errors: parsed.errors, warnings, name: manifest.name, rigFile: manifest.rig };
  const rig = parsed.rig;

  // arquivos: existem, são PNG, e as variantes têm o tamanho da imagem padrão
  const used = new Set<string>();
  for (const layer of rig.layers) {
    let base: { width: number; height: number } | null = null;
    for (const [variant, file] of Object.entries(layer.variants)) {
      used.add(file);
      const full = path.join(dir, file);
      if (!fs.existsSync(full)) {
        errors.push(`camada "${layer.id}": ${file} não existe${variant === 'default' ? '' : ` (variante "${variant}")`}`);
        continue;
      }
      const size = pngSize(fs.readFileSync(full));
      if (!size) {
        errors.push(`camada "${layer.id}": ${file} não é um PNG`);
        continue;
      }
      if (variant === 'default') base = size;
      else if (base && (size.width !== base.width || size.height !== base.height)) {
        errors.push(`camada "${layer.id}": a variante "${variant}" (${size.width}×${size.height}) tem que ter o tamanho da imagem padrão (${base.width}×${base.height})`);
      }
    }
    if (base && (layer.pivot[0] < 0 || layer.pivot[1] < 0 || layer.pivot[0] > base.width || layer.pivot[1] > base.height)) {
      warnings.push(`camada "${layer.id}": o pivô [${layer.pivot.join(', ')}] está fora da imagem (${base.width}×${base.height})`);
    }
  }
  const orphan = listPngs(dir).filter((f) => !used.has(f) && !f.startsWith('previews/'));
  if (orphan.length) warnings.push(`PNGs que nenhuma camada usa: ${orphan.join(', ')}`);

  // estados do app sem pose/expressão própria (caem no repouso / ficam neutros)
  const poseNames = new Set(Object.keys(rig.poses));
  if (!poseNames.has('idle')) warnings.push('sem pose "idle": o repouso é o rig como está montado');
  const missingPoses = [...new Set([...CHARACTER_STATES.map((s) => s.pose as string), ...MOTION_POSES])].filter((p) => !poseNames.has(p));
  if (missingPoses.length) warnings.push(`poses que o app usa e a skin não tem (caem no idle): ${missingPoses.join(', ')}`);
  const unknownPoses = [...poseNames].filter((p) => !(POSES as readonly string[]).includes(p));
  if (unknownPoses.length) warnings.push(`poses que o app nunca pede: ${unknownPoses.join(', ')}`);
  const missingExpr = EXPRESSIONS_USED.filter((e) => e !== 'neutral' && !rig.expressions[e]);
  if (missingExpr.length) warnings.push(`expressões que o app usa e a skin não tem (ficam neutras): ${missingExpr.join(', ')}`);
  if (!rig.controllers.blink) warnings.push('sem piscada (controllers.blink)');
  if (!rig.controllers.talk) warnings.push('sem boca falando (controllers.talk)');
  if (!rig.controllers.walk) warnings.push('sem passos ao andar (controllers.walk)');

  return { ok: errors.length === 0, errors, warnings, rig, rigFile: manifest.rig, name: manifest.name };
}
