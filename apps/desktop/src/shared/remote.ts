// Tera no celular (rede de casa): protocolo e criptografia, iguais no app e na página do
// celular.
//
// Na rede local não há HTTPS de verdade, e sem HTTPS o navegador do celular desliga a
// criptografia nativa (crypto.subtle). Então tudo vai cifrado com o tweetnacl (secretbox:
// XSalsa20-Poly1305, autenticado), com a chave que o QR code leva na parte do link depois
// do "#" — essa parte nunca sai do celular. Quem está no mesmo Wi-Fi só vê bytes cifrados.
import nacl from 'tweetnacl';
import type { LiveSnapshot, ProviderUsage } from './live';

export const REMOTE_DEFAULT_PORT = 7778;
/** Quanto tempo o QR code vale */
export const PAIR_TTL_MS = 90_000;
/** Pedido mais velho que isso é recusado (alguém repetindo um pedido gravado) */
export const MAX_AGE_MS = 60_000;

const enc = new TextEncoder();
const dec = new TextDecoder();

export function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  try {
    const s = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4));
    return Uint8Array.from(s, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

export const newKey = (): Uint8Array => nacl.randomBytes(nacl.secretbox.keyLength);
export const newId = (): string => b64url(nacl.randomBytes(12));

/** Uma mensagem cifrada: nonce + conteúdo, os dois em base64url */
export interface Sealed {
  n: string;
  c: string;
}

export function seal(key: Uint8Array, data: unknown): Sealed {
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  return { n: b64url(nonce), c: b64url(nacl.secretbox(enc.encode(JSON.stringify(data)), nonce, key)) };
}

/** Abre e confere (chave errada ou mensagem alterada = null) */
export function open<T>(key: Uint8Array, sealed: unknown): T | null {
  const s = sealed as Partial<Sealed> | null;
  if (typeof s?.n !== 'string' || typeof s.c !== 'string') return null;
  const nonce = fromB64url(s.n);
  const box = fromB64url(s.c);
  if (!nonce || !box || nonce.length !== nacl.secretbox.nonceLength) return null;
  const plain = nacl.secretbox.open(box, nonce, key);
  if (!plain) return null;
  try {
    return JSON.parse(dec.decode(plain)) as T;
  } catch {
    return null;
  }
}

/** O que vai no QR: http://<ip>:<porta>/#p=<pareamento>.<chave> */
export function pairLink(host: string, port: number, pairId: string, key: Uint8Array): string {
  return `http://${host}:${port}/#p=${pairId}.${b64url(key)}`;
}

export function parsePairFragment(hash: string): { pairId: string; key: Uint8Array } | null {
  const m = /^#p=([A-Za-z0-9_-]{8,40})\.([A-Za-z0-9_-]{40,50})$/.exec(hash);
  const key = m ? fromB64url(m[2]!) : null;
  return m && key?.length === nacl.secretbox.keyLength ? { pairId: m[1]!, key } : null;
}

// ---------- mensagens (todas dentro do envelope cifrado) ----------

/** Celular → app no pareamento */
export interface PairHello {
  name: string;
  at: number;
}

export type PairStatus = 'waiting' | 'approved' | 'denied' | 'expired';

/** Celular → app depois de pareado */
export interface RemoteRequest {
  op: 'snapshot';
  at: number;
}

/** App → celular */
export interface RemoteSnapshot {
  pcName: string;
  live: LiveSnapshot;
  usage: ProviderUsage[];
  at: number;
}

/** Celular pareado (o que fica nos Ajustes do app) */
export interface RemoteDevice {
  id: string;
  name: string;
  pairedAt: number;
  lastSeen?: number;
}

/** O que a interface mostra na parte "Celular" */
export interface RemoteState {
  enabled: boolean;
  /** Endereço na rede de casa (null = sem rede local) */
  address: string | null;
  devices: RemoteDevice[];
  /** QR code em andamento */
  pairing: { qr: string; link: string; expiresAt: number } | null;
  /** Celular pedindo pra conectar (precisa do "sim" no PC) */
  pending: { name: string } | null;
  error?: string;
}
