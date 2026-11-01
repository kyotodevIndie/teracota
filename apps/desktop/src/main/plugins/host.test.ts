import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ BrowserWindow: class {}, ipcMain: { on: vi.fn() }, session: {} }));
const { allowedUrl, checkCall } = await import('./host');

describe('chamadas de plugin', () => {
  it('só passa o que a permissão libera', () => {
    expect(checkCall({ method: 'say', text: 'oi' }, [])).toBeNull();
    expect(checkCall({ method: 'say', text: 'oi', expression: 'happy' }, ['say'])).toEqual({ method: 'say', text: 'oi', expression: 'happy' });
    expect(checkCall({ method: 'say', text: 'oi', expression: 'raiva' }, ['say'])).toEqual({ method: 'say', text: 'oi' });
    expect(checkCall({ method: 'card.set', id: 'x', title: 'T' }, ['say'])).toBeNull();
    expect(checkCall({ method: 'session.update', id: 's', project: 'p' }, ['cards'])).toBeNull();
    expect(checkCall({ method: 'desconhecido' }, ['say', 'cards', 'agent'])).toBeNull();
  });

  it('corta textos, prende o progresso e recusa ids estranhos', () => {
    const c = checkCall({ method: 'card.set', id: 'foco', title: 'x'.repeat(200), progress: 3, level: 'xyz' }, ['cards']);
    expect(c).toMatchObject({ id: 'foco', progress: 1, level: 'normal' });
    expect((c as { title: string }).title).toHaveLength(80);
    expect(checkCall({ method: 'card.set', id: '../x', title: 'T' }, ['cards'])).toBeNull();
  });

  it('limites de uso validados', () => {
    expect(checkCall({ method: 'usage.set', windows: [{ id: 'five_hour', usedPct: 40 }] }, ['agent'])).toEqual({ method: 'usage.set', windows: [{ id: 'five_hour', usedPct: 40, resetsAt: null }] });
    expect(checkCall({ method: 'usage.set', windows: [{ id: 'hora', usedPct: 40 }] }, ['agent'])).toBeNull();
  });

  it('rede: só https pros hosts declarados', () => {
    const page = 'file:///app/plugin-host.html';
    const perms = ['network:api.github.com'] as const;
    expect(allowedUrl(page, [...perms], page)).toBe(true);
    expect(allowedUrl('https://api.github.com/repos', [...perms], page)).toBe(true);
    expect(allowedUrl('http://api.github.com/repos', [...perms], page)).toBe(false);
    expect(allowedUrl('https://evil.com', [...perms], page)).toBe(false);
    expect(allowedUrl('file:///etc/passwd', [...perms], page)).toBe(false);
    expect(allowedUrl('http://127.0.0.1:7777/event', [...perms], page)).toBe(false);
  });
});
