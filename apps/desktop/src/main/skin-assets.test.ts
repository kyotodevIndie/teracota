// As skins que vêm no repositório (assets/ na raiz do monorepo e dev/skins do app) são válidas.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseRigManifest } from '@tera/character/rig';
import { parseSkinManifest } from '@tera/character/skin';

const APP = path.resolve(__dirname, '..', '..');
const ASSETS = path.resolve(APP, '..', '..', 'assets');
const readJson = (file: string): unknown => JSON.parse(fs.readFileSync(file, 'utf8'));

describe('skins do repositório', () => {
  it('a skin original da Tera (sprites, fallback do rig) continua válida', () => {
    const skin = parseSkinManifest(readJson(path.join(ASSETS, 'skins', 'tera', 'skin.json')));
    expect(skin?.type).toBeUndefined();
    expect(Object.keys(skin!.animations)).toHaveLength(13);
  });

  it('o rig experimental de desenvolvimento é válido', () => {
    expect(parseRigManifest(readJson(path.join(APP, 'dev', 'skins', 'tera-rig', 'rig.json'))).errors).toBeUndefined();
  });
});
