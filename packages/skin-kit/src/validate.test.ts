import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSkin, SCHEMA_FILE } from './scaffold';
import { validateSkinDir } from './validate';

/** O rig provisório da Tera, que vem no repositório */
const TEMPLATE = path.resolve(__dirname, '..', '..', '..', 'assets', 'skins', 'tera-rig');

let tmp: string;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tera-skin-')); });
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

const rigOf = (dir: string) => JSON.parse(fs.readFileSync(path.join(dir, 'rig.json'), 'utf8'));
const saveRig = (dir: string, rig: unknown) => fs.writeFileSync(path.join(dir, 'rig.json'), JSON.stringify(rig));

describe('skin nova', () => {
  it('copia o modelo, troca o nome e liga o schema', () => {
    const dir = path.join(tmp, 'minha');
    const r = createSkin(TEMPLATE, dir, 'Minha Tera');
    expect(r.files).toBeGreaterThan(10);
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'skin.json'), 'utf8')).name).toBe('Minha Tera');
    expect(rigOf(dir).$schema).toBe(`./${SCHEMA_FILE}`);
    expect(fs.existsSync(path.join(dir, SCHEMA_FILE))).toBe(true);
  });

  it('não sobrescreve pasta com conteúdo', () => {
    fs.writeFileSync(path.join(tmp, 'x'), '');
    expect(() => createSkin(TEMPLATE, tmp, 'x')).toThrow(/não está vazia/);
  });
});

describe('validar a pasta da skin', () => {
  it('o rig provisório da Tera passa (só avisos)', () => {
    const r = validateSkinDir(TEMPLATE);
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.rig?.layers.length).toBeGreaterThan(5);
  });

  it('acusa arquivo que falta', () => {
    const dir = path.join(tmp, 's');
    createSkin(TEMPLATE, dir, 's');
    fs.rmSync(path.join(dir, 'parts', 'body.png'));
    const r = validateSkinDir(dir);
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toMatch(/camada "body": parts\/body\.png não existe/);
  });

  it('acusa variante de tamanho diferente da imagem padrão', () => {
    const dir = path.join(tmp, 's');
    createSkin(TEMPLATE, dir, 's');
    // a boca aberta vira a imagem do corpo (outro tamanho)
    fs.copyFileSync(path.join(dir, 'parts', 'body.png'), path.join(dir, 'parts', 'mouth_open.png'));
    expect(validateSkinDir(dir).errors.join('\n')).toMatch(/variante "open".*tem que ter o tamanho/);
  });

  it('erros do rig.json vêm com o nome da camada', () => {
    const dir = path.join(tmp, 's');
    createSkin(TEMPLATE, dir, 's');
    const rig = rigOf(dir);
    rig.layers[1].parent = 'nao-existe';
    saveRig(dir, rig);
    expect(validateSkinDir(dir).errors.join('\n')).toMatch(/pai "nao-existe" não existe/);
  });

  it('valida um rig ainda não salvo (o que está no Studio)', () => {
    const dir = path.join(tmp, 's');
    createSkin(TEMPLATE, dir, 's');
    expect(validateSkinDir(dir, { canvas: 512, layers: [] }).errors.join('\n')).toMatch(/pelo menos uma camada/);
  });

  it('avisa PNG sem uso e estados sem pose', () => {
    const dir = path.join(tmp, 's');
    createSkin(TEMPLATE, dir, 's');
    fs.copyFileSync(path.join(dir, 'parts', 'body.png'), path.join(dir, 'parts', 'sobra.png'));
    const rig = rigOf(dir);
    delete rig.poses.sleep;
    saveRig(dir, rig);
    const w = validateSkinDir(dir).warnings.join('\n');
    expect(w).toMatch(/sobra\.png/);
    expect(w).toMatch(/sleep/);
  });

  it('pasta sem skin.json ou skin de sprites', () => {
    expect(validateSkinDir(tmp).errors[0]).toMatch(/skin\.json/);
    fs.writeFileSync(path.join(tmp, 'skin.json'), JSON.stringify({ name: 'x', animations: { idle: { frames: ['a.png'] } } }));
    expect(validateSkinDir(tmp).errors[0]).toMatch(/não é de rig/);
  });
});
