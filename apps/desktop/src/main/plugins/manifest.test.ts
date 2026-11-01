import { describe, expect, it } from 'vitest';
import { approvedAll, coerceSetting, isSafeScript, parsePluginManifest } from './manifest';

const base = { id: 'pomodoro', name: 'Pomodoro', version: '0.1.0', main: 'main.js', permissions: ['say', 'cards'] };

describe('manifesto de plugin', () => {
  it('aceita o básico e preenche o que falta', () => {
    const r = parsePluginManifest(base);
    expect(r.manifest).toMatchObject({ id: 'pomodoro', permissions: ['say', 'cards'], settings: [], badge: { text: 'Po' } });
  });

  it('recusa id inválido ou reservado, versão e main ruins', () => {
    expect(parsePluginManifest({ ...base, id: 'A b' }).error).toMatch(/id/);
    expect(parsePluginManifest({ ...base, id: 'claude-code' }).error).toMatch(/reservado/);
    expect(parsePluginManifest({ ...base, version: '1' }).error).toMatch(/version/);
    expect(parsePluginManifest({ ...base, main: '../fora.js' }).error).toMatch(/main/);
    expect(parsePluginManifest({ ...base, main: '/abs/main.js' }).error).toMatch(/main/);
  });

  it('permissões: só as conhecidas; rede só com host válido', () => {
    expect(parsePluginManifest({ ...base, permissions: ['network:api.github.com'] }).manifest?.permissions).toEqual(['network:api.github.com']);
    expect(parsePluginManifest({ ...base, permissions: ['fs'] }).error).toMatch(/desconhecida/);
    expect(parsePluginManifest({ ...base, permissions: ['network:*'] }).error).toMatch(/desconhecida/);
    expect(parsePluginManifest({ ...base, permissions: ['network:http://x.com'] }).error).toMatch(/desconhecida/);
  });

  it('ajustes: tipos e limites', () => {
    const r = parsePluginManifest({ ...base, settings: [{ key: 'minutos', label: 'Minutos', type: 'number', default: 25, min: 1, max: 90 }] });
    const s = r.manifest!.settings[0]!;
    expect(coerceSetting(s, 500)).toBe(90);
    expect(coerceSetting(s, 'x')).toBe(25);
    expect(parsePluginManifest({ ...base, settings: [{ key: 'x', label: 'X', type: 'number', default: 'a' }] }).error).toMatch(/ajuste/);
  });

  it('script seguro e permissões aprovadas', () => {
    expect(isSafeScript('src/main.js')).toBe(true);
    expect(isSafeScript('./main.js')).toBe(false);
    expect(approvedAll(['say'], ['say', 'cards'])).toBe(true);
    expect(approvedAll(['say', 'http'], ['say'])).toBe(false);
  });
});
