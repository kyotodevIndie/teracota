// Skin nova a partir de um modelo que já funciona (por padrão, o rig provisório da Tera):
// copia as partes e o rig.json, troca o nome e liga o JSON Schema no rig.json. Assim dá
// pra abrir no Studio ou mandar pro `tera-skin render` na hora, e ir trocando as partes.
import fs from 'node:fs';
import path from 'node:path';
import { RIG_SCHEMA } from './schema';

export const SCHEMA_FILE = 'rig.schema.json';

export interface ScaffoldResult {
  dir: string;
  files: number;
}

/** Copia `template` pra `dir` (que não pode existir com conteúdo) e dá o nome `name` à skin */
export function createSkin(template: string, dir: string, name: string): ScaffoldResult {
  if (fs.existsSync(dir) && fs.readdirSync(dir).length > 0) throw new Error(`a pasta ${dir} já existe e não está vazia`);
  if (!fs.existsSync(path.join(template, 'skin.json'))) throw new Error(`modelo sem skin.json: ${template}`);
  fs.mkdirSync(dir, { recursive: true });
  let files = 0;
  const copy = (from: string, to: string) => {
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
      if (entry.name === 'previews' || entry.name.endsWith('.bak')) continue;
      const src = path.join(from, entry.name);
      const dst = path.join(to, entry.name);
      if (entry.isDirectory()) {
        fs.mkdirSync(dst, { recursive: true });
        copy(src, dst);
      } else {
        fs.copyFileSync(src, dst);
        files++;
      }
    }
  };
  copy(template, dir);

  const skinFile = path.join(dir, 'skin.json');
  const skin = JSON.parse(fs.readFileSync(skinFile, 'utf8')) as Record<string, unknown>;
  skin.name = name;
  fs.writeFileSync(skinFile, `${JSON.stringify(skin, null, 2)}\n`);
  writeSchema(dir, typeof skin.rig === 'string' ? skin.rig : 'rig.json');
  return { dir, files };
}

/** Escreve rig.schema.json na pasta e aponta o rig.json pra ele (o editor passa a completar e validar) */
export function writeSchema(dir: string, rigFile = 'rig.json'): void {
  fs.writeFileSync(path.join(dir, SCHEMA_FILE), `${JSON.stringify(RIG_SCHEMA, null, 2)}\n`);
  const file = path.join(dir, rigFile);
  if (!fs.existsSync(file)) return;
  const rig = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
  if (rig.$schema === `./${SCHEMA_FILE}`) return;
  fs.writeFileSync(file, `${JSON.stringify({ $schema: `./${SCHEMA_FILE}`, ...rig }, null, 2)}\n`);
}
