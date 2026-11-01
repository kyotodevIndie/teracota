import { describe, expect, it } from 'vitest';
import { formatReport, parseArgs } from './cli';

describe('tera-skin', () => {
  it('lê comando, pasta e opções', () => {
    expect(parseArgs(['render', 'skins/x', '--pivos', '--saida', 'out'])).toEqual({ cmd: 'render', dir: 'skins/x', flags: { pivos: true, saida: 'out' } });
  });

  it('relatório: erros e avisos em linhas próprias', () => {
    const text = formatReport({ ok: false, errors: ['camada "a": x'], warnings: ['sem piscada'] }, 'x');
    expect(text).toMatch(/✗/);
    expect(text).toMatch(/erro: camada "a": x/);
    expect(text).toMatch(/aviso: sem piscada/);
  });
});
