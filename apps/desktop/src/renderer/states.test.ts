import { describe, expect, it } from 'vitest';
import { CHARACTER_STATES } from '@tera/character/states';
import { STATE_DEFS } from './states';

describe('estados da Tera', () => {
  it('a lista do Skin Studio bate com a do app (pose e expressão de cada estado)', () => {
    expect(Object.fromEntries(CHARACTER_STATES.map((s) => [s.id, [s.pose, s.expression]])))
      .toEqual(Object.fromEntries(Object.entries(STATE_DEFS).map(([id, d]) => [id, [d.pose, d.expression]])));
  });
});
