// O mínimo de PNG que as ferramentas de skin precisam: o tamanho da imagem (cabeçalho IHDR)
// e se o arquivo é mesmo um PNG. Sem dependências.

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export const isPng = (buf: Uint8Array): boolean =>
  buf.length >= 24 && Buffer.from(buf.subarray(0, 8)).equals(SIGNATURE) && Buffer.from(buf.subarray(12, 16)).toString('ascii') === 'IHDR';

/** Largura e altura do PNG; null se não for um PNG */
export function pngSize(buf: Uint8Array): { width: number; height: number } | null {
  if (!isPng(buf)) return null;
  const view = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  const width = view.readUInt32BE(16);
  const height = view.readUInt32BE(20);
  return width > 0 && height > 0 ? { width, height } : null;
}
