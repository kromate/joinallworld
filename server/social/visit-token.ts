/**
 * OWNER: social
 * THE SIGNED HOUSE LINK: `/h/<token>`. [version, host, link id, expires] and an HMAC-SHA-256 over them with a key this server
 * makes for itself (ctx.keyFile), under a purpose of its own so that no other signed link in the game can stand in for it.
 * It is bound to one host, is unguessable (the link id is random, the signature cannot be made without the key) and runs out
 * on its own. It names a link record (db.visits.links) and nothing else: whether the link still works, how often it was used and
 * who was removed through it are in that record, which the host can end at once. Opening it signs nobody in.
 * Portable: no Node imports.
 */
import { UUID_PATTERN } from '../protocol.ts';
import { b64u } from '../growth/webpush.ts';
import type { RouteContext } from '../types.ts';

const VERSION = 1, BODY_BYTES = 31, BODY_CHARS = 42, TOKEN_CHARS = 85;
export const HOUSE_TOKEN = /^[A-Za-z0-9_-]{85}$/;
const PURPOSE = new TextEncoder().encode('allworld-house-link|');
const uuidBytes = (id: string): Uint8Array => Uint8Array.from((id.replace(/-/g, '').match(/../g) ?? []).map((pair) => parseInt(pair, 16)));
const bytesUuid = (bytes: Uint8Array): string => { const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join(''); return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`; };

/** What a house link says, once its signature has been checked. */
export interface HouseClaim { host: string; link: string; expires: number }
type SigningKey = Awaited<ReturnType<typeof globalThis.crypto.subtle.importKey>>;

export function houseTokens(ctx: RouteContext) {
  let signing: Promise<SigningKey> | null = null;
  const key = (): Promise<SigningKey> => (signing ??= (async () => {
    const stored = await ctx.keyFile('house-link-signing', () => ({ key: b64u.encode(globalThis.crypto.getRandomValues(new Uint8Array(32))) }));
    return globalThis.crypto.subtle.importKey('raw', b64u.decode(stored.key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  })().catch((error: unknown) => { signing = null; throw error; }));
  const signed = (body: Uint8Array): Uint8Array<ArrayBuffer> => { const out = new Uint8Array(PURPOSE.length + body.length); out.set(PURPOSE, 0); out.set(body, PURPOSE.length); return out; };
  return {
    /** A fresh random link id (what the record is kept under). */
    newId: (): string => b64u.encode(globalThis.crypto.getRandomValues(new Uint8Array(8))),
    /** The path of one link. */
    async sign(host: string, link: string, expires: number): Promise<string> {
      const body = new Uint8Array(BODY_BYTES);
      body[0] = VERSION; body.set(uuidBytes(host), 1); body.set(b64u.decode(link), 17);
      for (let i = 0; i < 6; i++) body[25 + i] = Math.floor(expires / 2 ** (8 * (5 - i))) % 256;
      return `/h/${b64u.encode(body)}${b64u.encode(await globalThis.crypto.subtle.sign('HMAC', await key(), signed(body)))}`;
    },
    /** What a token says, or null: a wrong shape, a wrong signature, another version, or past its time. */
    async read(value: unknown, now: number): Promise<HouseClaim | null> {
      if (typeof value !== 'string' || value.length !== TOKEN_CHARS || !HOUSE_TOKEN.test(value)) return null;
      try {
        const body = b64u.decode(value.slice(0, BODY_CHARS)), signature = b64u.decode(value.slice(BODY_CHARS));
        // One spelling only: a link is not accepted in a second form of the same bytes.
        if (body.length !== BODY_BYTES || body[0] !== VERSION || `${b64u.encode(body)}${b64u.encode(signature)}` !== value) return null;
        if (!(await globalThis.crypto.subtle.verify('HMAC', await key(), signature, signed(body)))) return null;
        let expires = 0;
        for (let i = 0; i < 6; i++) expires = expires * 256 + (body[25 + i] ?? 0);
        const host = bytesUuid(body.slice(1, 17));
        if (!UUID_PATTERN.test(host) || !(expires > now)) return null;
        return { host, link: b64u.encode(body.slice(17, 25)), expires };
      } catch { return null; }
    },
  };
}
export type HouseTokens = ReturnType<typeof houseTokens>;
