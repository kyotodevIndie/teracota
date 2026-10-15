import { describe, expect, it, vi } from 'vitest';
import { SIM_PROVIDER_ID } from '../bridge/simulated';
import { resolvePickFolder } from './pick-folder';

function deps() {
  return { makeTemp: vi.fn(() => '/tmp/teracota-sim-x'), openDialog: vi.fn(async () => '/work/proj') };
}

describe('resolvePickFolder', () => {
  it('simulado com sim ligado usa a pasta temporária, sem diálogo', async () => {
    const d = deps();
    expect(await resolvePickFolder(SIM_PROVIDER_ID, true, d)).toBe('/tmp/teracota-sim-x');
    expect(d.openDialog).not.toHaveBeenCalled();
  });
  it('simulado com sim desligado usa o diálogo', async () => {
    const d = deps();
    expect(await resolvePickFolder(SIM_PROVIDER_ID, false, d)).toBe('/work/proj');
    expect(d.makeTemp).not.toHaveBeenCalled();
  });
  it('provider real sempre usa o diálogo', async () => {
    for (const sim of [true, false]) {
      const d = deps();
      expect(await resolvePickFolder('claude-code', sim, d)).toBe('/work/proj');
      expect(d.makeTemp).not.toHaveBeenCalled();
    }
  });
});
