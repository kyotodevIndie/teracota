import { afterAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import { openCore } from './open-core';
import { LockBusyError } from './process/os-lock';
import { tmpDir } from './testing/helpers';

const tmp = tmpDir('pocket-core-');
afterAll(() => tmp.cleanup());

describe('openCore (lock → store → varredura)', () => {
  it('segunda instância no mesmo banco recebe LOCK_BUSY sem tocar no banco; liberar permite reabrir', async () => {
    const db = path.join(tmp.dir, 'core.db');
    const a = await openCore(db, { label: 'a' });
    const fenceA = a.store.fence;
    const err = await openCore(db, { label: 'b' }).catch((e) => e);
    expect(err).toBeInstanceOf(LockBusyError);
    expect(a.store.fenceIsCurrent()).toBe(true); // o intruso não mexeu no fence
    expect(a.store.fence).toBe(fenceA);
    await a.close();
    const c = await openCore(db, { label: 'c' });
    expect(c.store.fence).toBe(fenceA + 1);
    expect(c.orphans.killed).toEqual([]);
    await c.close();
  }, 30_000);

  it('caminhos diferentes do mesmo arquivo (relativo/maiúsculas) disputam o mesmo lock', async () => {
    const db = path.join(tmp.dir, 'Alias.db');
    const a = await openCore(db);
    const err = await openCore(path.join(tmp.dir, '..', path.basename(tmp.dir), 'alias.DB')).catch((e) => e);
    expect(err).toBeInstanceOf(LockBusyError);
    await a.close();
  }, 30_000);
});
