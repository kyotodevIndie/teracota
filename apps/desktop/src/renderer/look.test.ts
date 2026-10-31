import { describe, expect, it } from 'vitest';
import { poseFor } from './look';

describe('poseFor', () => {
  it('a animação tem prioridade sobre a expressão', () => {
    expect(poseFor('happy', 'wave')).toBe('wave');
    expect(poseFor('neutral', 'shake')).toBe('error');
  });

  it('sem animação mapeada, usa a expressão', () => {
    expect(poseFor('sad', 'breathe')).toBe('sad');
    expect(poseFor('focused')).toBe('think');
  });

  it('sem nada, não decide', () => {
    expect(poseFor()).toBeUndefined();
    expect(poseFor(undefined, 'bob')).toBeUndefined();
  });
});
