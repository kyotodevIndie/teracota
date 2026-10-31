import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_TIMEOUT_MS, SessionTracker, WORKING_STALE_NO_COMPLETION_MS, projectName, sessionKey } from './sessions';

const info = (project: string, provider = 'claude-code', reportsCompletion = true) => ({ provider, project, reportsCompletion });

describe('projectName', () => {
  it('usa o nome da pasta, com barras de qualquer sistema', () => {
    expect(projectName('K:\\dev\\front')).toBe('front');
    expect(projectName('/home/ana/api-server/')).toBe('api-server');
  });

  it('sem pasta, não inventa nome', () => {
    expect(projectName(undefined)).toBeUndefined();
    expect(projectName('')).toBeUndefined();
  });
});

describe('sessionKey', () => {
  it('separa sessões de agentes diferentes com o mesmo id', () => {
    expect(sessionKey('claude-code', 'abc')).not.toBe(sessionKey('codex', 'abc'));
  });
});

describe('SessionTracker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => vi.useRealTimers());

  it('lista as sessões da mais recente pra mais antiga', () => {
    const t = new SessionTracker();
    t.touch('a', info('api'));
    vi.advanceTimersByTime(1000);
    t.touch('b', info('front'));
    expect(t.list().map((s) => s.key)).toEqual(['b', 'a']);
    expect(t.size).toBe(2);
  });

  it('conta quantos agentes diferentes estão abertos', () => {
    const t = new SessionTracker();
    t.touch('claude-code:1', info('api'));
    t.touch('claude-code:2', info('front'));
    expect(t.providerCount()).toBe(1);
    t.touch('codex:1', info('hera', 'codex'));
    expect(t.providerCount()).toBe(2);
  });

  it('sabe se alguma sessão está trabalhando', () => {
    const t = new SessionTracker();
    t.touch('a', info('api'));
    t.touch('b', info('front')).working = true;
    expect(t.anyWorking()).toBe(true);
    t.remove('b');
    expect(t.anyWorking()).toBe(false);
  });

  it('agente que avisa conclusão: solta o "trabalhando" travado só depois de 10 min', () => {
    const t = new SessionTracker();
    t.touch('a', info('api')).working = true;
    vi.advanceTimersByTime(5 * 60 * 1000);
    expect(t.prune().workingChanged).toBe(false);
    vi.advanceTimersByTime(6 * 60 * 1000);
    expect(t.prune()).toEqual({ removed: [], workingChanged: true });
    expect(t.anyWorking()).toBe(false);
  });

  it('agente que não avisa conclusão: "trabalhando" expira em 1 min sem eventos', () => {
    const t = new SessionTracker();
    t.touch('x', info('hera', 'meu-agente', false)).working = true;
    vi.advanceTimersByTime(WORKING_STALE_NO_COMPLETION_MS + 1000);
    expect(t.prune().workingChanged).toBe(true);
    expect(t.anyWorking()).toBe(false);
  });

  it('expira sessões sumidas (terminal fechado à força)', () => {
    const t = new SessionTracker();
    t.touch('velha', info('api'));
    vi.advanceTimersByTime(SESSION_TIMEOUT_MS - 1000);
    t.touch('nova', info('front'));
    vi.advanceTimersByTime(2000);
    expect(t.prune().removed).toEqual(['velha']);
    expect(t.list().map((s) => s.key)).toEqual(['nova']);
  });
});
