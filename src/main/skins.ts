// Descobre e carrega skins de:
//   <app>/assets/skins/<id>/skin.json      (skins que vêm com o app)
//   <userData>/skins/<id>/skin.json        (skins instaladas pelo usuário)
//   <repo>/dev/skins/<id>/skin.json        (só em desenvolvimento: skins experimentais, fora do instalador)
import { app, nativeImage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { assetsDir } from './paths';
import { parseRigManifest } from '../shared/rig';
import {
  HIT_MASK_SIZE, ORIGINAL_SKIN_ID, SVG_SKIN_ID, parseSkinManifest,
  type Pose, type SkinAnimation, type SkinInfo, type SkinManifest,
} from '../shared/skin';

export interface SkinEntry {
  id: string;
  name: string;
}

function skinRoots(): string[] {
  const roots = [path.join(assetsDir(), 'skins'), path.join(app.getPath('userData'), 'skins')];
  // skins experimentais (ex.: o rig com camadas provisórias) só aparecem em desenvolvimento
  if (!app.isPackaged) roots.push(path.join(app.getAppPath(), 'dev', 'skins'));
  return roots;
}

function findSkinDir(id: string): string | null {
  for (const root of skinRoots()) {
    const dir = path.join(root, id);
    if (fs.existsSync(path.join(dir, 'skin.json'))) return dir;
  }
  return null;
}

function readManifest(dir: string): SkinManifest | null {
  try {
    return parseSkinManifest(JSON.parse(fs.readFileSync(path.join(dir, 'skin.json'), 'utf8')));
  } catch (err) {
    console.error(`[teracota] skin em "${dir}" inválida:`, err);
    return null;
  }
}

/** Canal alfa do frame reduzido pra HIT_MASK_SIZE² */
function hitMask(file: string): Uint8Array {
  const img = nativeImage.createFromPath(file).resize({ width: HIT_MASK_SIZE, height: HIT_MASK_SIZE, quality: 'good' });
  const px = img.toBitmap(); // BGRA ou RGBA conforme a plataforma — o alfa é sempre o 4º byte
  const mask = new Uint8Array(HIT_MASK_SIZE * HIT_MASK_SIZE);
  for (let i = 0; i < mask.length; i++) mask[i] = px[i * 4 + 3] ?? 0;
  return mask;
}

const cache = new Map<string, SkinInfo>();

function readSkin(id: string): SkinInfo | null {
  const cached = cache.get(id);
  if (cached) return cached;
  const dir = findSkinDir(id);
  const manifest = dir && readManifest(dir);
  if (!dir || !manifest) return null;
  if (manifest.type === 'rig') return readRigSkin(id, dir, manifest);
  const hitMasks: SkinInfo['hitMasks'] = {};
  for (const [pose, anim] of Object.entries(manifest.animations) as [Pose, SkinAnimation][]) {
    hitMasks[pose] = anim.frames.map((f) => hitMask(path.join(dir, f)));
  }
  const skin: SkinInfo = { id, baseUrl: `${pathToFileURL(dir).href}/`, manifest, hitMasks };
  cache.set(id, skin);
  return skin;
}

/** Skin de rig: valida o rig.json e confere se as imagens existem (falha cedo, com motivo) */
function readRigSkin(id: string, dir: string, manifest: SkinManifest): SkinInfo | null {
  try {
    const parsed = parseRigManifest(JSON.parse(fs.readFileSync(path.join(dir, manifest.rig!), 'utf8')));
    const missing = parsed.rig?.layers.filter((l) => !fs.existsSync(path.join(dir, l.image))).map((l) => `camada "${l.id}": imagem ${l.image} não encontrada`) ?? [];
    const errors = [...(parsed.errors ?? []), ...missing];
    if (errors.length || !parsed.rig) {
      console.error(`[teracota] rig "${id}" inválido:\n  ${errors.join('\n  ')}`);
      return null;
    }
    const skin: SkinInfo = { id, baseUrl: `${pathToFileURL(dir).href}/`, manifest, hitMasks: {}, rig: parsed.rig };
    cache.set(id, skin);
    return skin;
  } catch (err) {
    console.error(`[teracota] rig "${id}" não pôde ser lido:`, err);
    return null;
  }
}

export function listSkins(): SkinEntry[] {
  const seen = new Map<string, SkinEntry>();
  for (const root of skinRoots()) {
    if (!fs.existsSync(root)) continue;
    for (const id of fs.readdirSync(root)) {
      if (seen.has(id)) continue;
      const manifest = readManifest(path.join(root, id));
      // rig inválido nem aparece no menu (o motivo vai pro log)
      if (manifest && (manifest.type !== 'rig' || readSkin(id))) seen.set(id, { id, name: manifest.name });
    }
  }
  return [...seen.values()];
}

/**
 * A skin configurada. Se ela falhar, a skin original da Tera (nunca "a primeira que
 * aparecer"); sem configuração, a original ou a primeira disponível; null = personagem SVG.
 */
export function loadSkin(id: string | undefined): SkinInfo | null {
  if (id === SVG_SKIN_ID) return null;
  if (id) {
    const skin = readSkin(id);
    if (skin) return skin;
  }
  const original = loadFallbackSkin();
  if (original) return original;
  const first = listSkins()[0];
  return first ? readSkin(first.id) : null;
}

/** A skin original da Tera (sprites): fallback explícito quando um rig falha no renderer */
export function loadFallbackSkin(): SkinInfo | null {
  return readSkin(ORIGINAL_SKIN_ID);
}
