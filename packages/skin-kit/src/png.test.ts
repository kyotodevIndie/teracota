import { describe, expect, it } from 'vitest';
import { isPng, pngSize } from './png';

const header = (w: number, h: number) => {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'ascii');
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
};

describe('PNG', () => {
  it('lê largura e altura do cabeçalho', () => {
    expect(pngSize(header(150, 170))).toEqual({ width: 150, height: 170 });
  });
  it('recusa o que não é PNG', () => {
    expect(isPng(Buffer.from('GIF89a................'))).toBe(false);
    expect(pngSize(Buffer.alloc(4))).toBeNull();
  });
});
