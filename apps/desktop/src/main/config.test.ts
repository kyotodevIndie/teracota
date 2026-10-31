import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let dir = '';

vi.mock('electron', () => ({
  app: { getPath: (name: string) => (name === 'userData' ? path.join(dir, 'Teracota') : dir) },
}));

const { loadConfig } = await import('./config');

function writeConfig(raw: unknown): void {
  fs.mkdirSync(path.join(dir, 'Teracota'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'Teracota', 'config.json'), JSON.stringify(raw));
}

describe('loadConfig', () => {
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'teracota-config-')); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('sem arquivo: padrões', () => {
    expect(loadConfig()).toEqual({ moveMode: 'roam', entityMode: 'single' });
  });

  it('quem estava no Mini Companion volta pra Tera completa, sem perder o resto', () => {
    writeConfig({ moveMode: 'stay', entityMode: 'multi', skin: 'tera', x: 10, y: 20, onboarded: true, ui: 'mini', companion: { x: 1, y: 2 }, companionMuted: true });
    const config = loadConfig() as unknown as Record<string, unknown>;
    expect(config).toEqual({ moveMode: 'stay', entityMode: 'multi', skin: 'tera', x: 10, y: 20, onboarded: true });
    expect(config.ui).toBeUndefined();
    expect(config.companion).toBeUndefined();
  });

  it('arquivo corrompido: padrões', () => {
    fs.mkdirSync(path.join(dir, 'Teracota'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'Teracota', 'config.json'), '{ quebrado');
    expect(loadConfig()).toEqual({ moveMode: 'roam', entityMode: 'single' });
  });
});
