import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildScript, disableUsage, enableUsage, parseRateLimits, scriptCommand, shQuote, usageEnabled } from './statusline';

describe('limites do plano (statusline do Claude Code)', () => {
  it('lê as janelas de 5 horas e da semana', () => {
    expect(parseRateLimits({ rate_limits: { five_hour: { used_percentage: 42, resets_at: 1000 }, seven_day: { used_percentage: 25.5, resets_at: 2000 } } }))
      .toEqual([{ id: 'five_hour', usedPct: 42, resetsAt: 1_000_000 }, { id: 'seven_day', usedPct: 25.5, resetsAt: 2_000_000 }]);
  });

  it('sem plano (chave de API) ou JSON estranho: nada', () => {
    expect(parseRateLimits({ model: {} })).toEqual([]);
    expect(parseRateLimits(null)).toEqual([]);
    expect(parseRateLimits({ rate_limits: { five_hour: { used_percentage: 'x' } } })).toEqual([]);
  });

  it('o script repassa pro app em segundo plano e chama a statusline anterior', () => {
    const s = buildScript(7777, "echo 'oi'");
    expect(s).toContain('http://127.0.0.1:7777/usage/claude-code');
    expect(s).toContain('&\n');
    expect(s).toContain(`sh -c ${shQuote("echo 'oi'")}`);
    expect(buildScript(7777, null)).not.toContain('sh -c');
  });

  it('caminho com caracteres que o sh interpretaria é recusado', () => {
    expect(scriptCommand('/home/a b/x.sh')).toBe('sh "/home/a b/x.sh"');
    expect(scriptCommand('/home/$x/x.sh')).toBeNull();
    expect(scriptCommand('/home/"x/x.sh')).toBeNull();
  });
});

describe('ligar e desligar mexe só na statusLine e devolve a anterior', () => {
  let dir: string;
  let paths: { settings: string; dataDir: string };
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'teracota-sl-'));
    paths = { settings: path.join(dir, 'claude', 'settings.json'), dataDir: path.join(dir, 'app') };
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
  const read = () => JSON.parse(fs.readFileSync(paths.settings, 'utf8'));

  it('com statusline do usuário: guarda, envolve e devolve igual', () => {
    fs.mkdirSync(path.dirname(paths.settings), { recursive: true });
    const mine = { type: 'command', command: '~/bin/minha-status', padding: 1 };
    fs.writeFileSync(paths.settings, JSON.stringify({ theme: 'dark', statusLine: mine }));
    expect(enableUsage(paths, 7777)).toBe(true);
    expect(usageEnabled(paths)).toBe(true);
    expect(read().theme).toBe('dark');
    expect(read().statusLine.padding).toBe(1);
    expect(fs.readFileSync(path.join(paths.dataDir, 'claude-statusline.sh'), 'utf8')).toContain('~/bin/minha-status');
    // ligar de novo não perde a original
    expect(enableUsage(paths, 7777)).toBe(true);
    expect(disableUsage(paths)).toBe(true);
    expect(read()).toEqual({ theme: 'dark', statusLine: mine });
    expect(usageEnabled(paths)).toBe(false);
  });

  it('sem statusline: liga e, ao desligar, tira a chave', () => {
    expect(enableUsage(paths, 7777)).toBe(true);
    expect(read().statusLine.type).toBe('command');
    expect(disableUsage(paths)).toBe(true);
    expect(read()).toEqual({});
  });

  it('settings.json ilegível: não mexe', () => {
    fs.mkdirSync(path.dirname(paths.settings), { recursive: true });
    fs.writeFileSync(paths.settings, '{ quebrado');
    expect(enableUsage(paths, 7777)).toBe(false);
    expect(fs.readFileSync(paths.settings, 'utf8')).toBe('{ quebrado');
  });

  it('statusline de outro programa: desligar não toca', () => {
    fs.mkdirSync(path.dirname(paths.settings), { recursive: true });
    fs.writeFileSync(paths.settings, JSON.stringify({ statusLine: { type: 'command', command: 'outra' } }));
    expect(disableUsage(paths)).toBe(true);
    expect(read().statusLine.command).toBe('outra');
  });
});
