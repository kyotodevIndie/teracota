import { describe, expect, it } from 'vitest';
import { parseEvent, parseIncoming, parseSource } from './protocol';

describe('parseSource', () => {
  it('aceita provider em formato slug, sessão e projeto', () => {
    expect(parseSource({ provider: 'Meu-Agente', sessionId: ' s1 ', project: 'hera' }))
      .toEqual({ provider: 'meu-agente', sessionId: 's1', project: 'hera' });
  });

  it('rejeita provider inválido', () => {
    expect(parseSource({ provider: 'com espaço' })).toBeUndefined();
    expect(parseSource({ provider: '' })).toBeUndefined();
    expect(parseSource({ provider: 'x'.repeat(41) })).toBeUndefined();
    expect(parseSource('claude')).toBeUndefined();
  });
});

describe('parseIncoming', () => {
  it('evento simples (sem origem) continua funcionando', () => {
    expect(parseIncoming({ state: 'happy', say: 'oi' })).toEqual({ event: { state: 'happy', say: 'oi' } });
  });

  it('evento com origem e ciclo de vida', () => {
    expect(parseIncoming({ state: 'typing', working: true, source: { provider: 'meu-agente', sessionId: 'a', project: 'hera' }, lifecycle: 'start' }))
      .toEqual({ event: { state: 'typing', working: true }, source: { provider: 'meu-agente', sessionId: 'a', project: 'hera' }, lifecycle: 'start' });
  });

  it('só ciclo de vida, sem visual, vale quando tem origem', () => {
    expect(parseIncoming({ source: { provider: 'x' }, lifecycle: 'end' })).toEqual({ event: null, source: { provider: 'x' }, lifecycle: 'end' });
    expect(parseIncoming({ lifecycle: 'end' })).toBeNull();
  });

  it('origem inválida é ignorada, não derruba o evento', () => {
    expect(parseIncoming({ state: 'idle', source: { provider: '???' } })).toEqual({ event: { state: 'idle' } });
  });
});

describe('parseEvent', () => {
  it('aceita um evento completo', () => {
    expect(parseEvent({ state: 'typing', expression: 'happy', anim: 'jump', say: 'oi', duration: 500, working: true, from: 'api' }))
      .toEqual({ state: 'typing', expression: 'happy', anim: 'jump', say: 'oi', duration: 500, working: true, from: 'api' });
  });

  it('descarta campos inválidos e mantém os válidos', () => {
    expect(parseEvent({ state: 'voando', expression: 'happy', duration: -1, working: 'sim' })).toEqual({ expression: 'happy' });
  });

  it('retorna null quando não sobra nada', () => {
    expect(parseEvent({ state: 'voando' })).toBeNull();
    expect(parseEvent(null)).toBeNull();
    expect(parseEvent('typing')).toBeNull();
    expect(parseEvent([])).toBeNull();
  });

  it('corta textos longos e limita a duração', () => {
    const ev = parseEvent({ say: `  ${'a'.repeat(500)}  `, from: 'x'.repeat(100), duration: 10 * 60_000 });
    expect(ev?.say).toHaveLength(280);
    expect(ev?.from).toHaveLength(40);
    expect(ev?.duration).toBe(60_000);
  });

  it('ignora fala vazia', () => {
    expect(parseEvent({ say: '   ', state: 'idle' })).toEqual({ state: 'idle' });
  });
});
