// As skins que vêm no repositório (assets/ na raiz do monorepo) são válidas.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseRigManifest } from '@tera/character/rig';
import { parseSkinManifest } from '@tera/character/skin';

const ASSETS = path.resolve(__dirname, '..', '..', '..', '..', 'assets');
const readJson = (file: string): unknown => JSON.parse(fs.readFileSync(file, 'utf8'));

describe('skins do repositório', () => {
  it('a skin original da Tera (sprites, fallback do rig) continua válida', () => {
    const skin = parseSkinManifest(readJson(path.join(ASSETS, 'skins', 'tera', 'skin.json')));
    expect(skin?.type).toBeUndefined();
    expect(Object.keys(skin!.animations)).toHaveLength(13);
  });

  it('o rig padrão é válido e todas as imagens (inclusive variantes) existem', () => {
    const dir = path.join(ASSETS, 'skins', 'tera-rig');
    const skin = parseSkinManifest(readJson(path.join(dir, 'skin.json')));
    expect(skin?.type).toBe('rig');
    const parsed = parseRigManifest(readJson(path.join(dir, skin!.rig!)));
    expect(parsed.errors).toBeUndefined();
    const files = parsed.rig!.layers.flatMap((l) => Object.values(l.variants));
    expect(files.filter((f) => !fs.existsSync(path.join(dir, f)))).toEqual([]);
    // os estados essenciais da Tera têm pose própria
    for (const pose of ['idle', 'walk', 'drag', 'land', 'work', 'think', 'happy', 'error', 'sleep', 'wave', 'surprised']) {
      expect(parsed.rig!.poses[pose], pose).toBeDefined();
    }
    expect(Object.keys(parsed.rig!.controllers).sort()).toEqual(['blink', 'breathe', 'gaze', 'sway', 'talk', 'walk']);
  });
});
