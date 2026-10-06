/**
 * OWNER: admin
 * THE SECOND REQUEST OF A DESTRUCTIVE ACTION. The first request (no `confirm`) changes nothing and answers a confirmation token;
 * the second carries it. A token is an HMAC (a key this host makes for itself, ctx.keyFile) over the admin's account, the action,
 * the target and the parameters, with an expiry: it cannot be used by another admin, for another target or another parameter, or
 * after FIVE minutes, and nothing is stored to check it. Checked in constant time (crypto.subtle.verify).
 */
import type { RouteContext } from '../types.ts';

export const CONFIRM_TTL_MS = 5 * 60000;
const b64 = {
  encode(bytes: Uint8Array): string { let text = ''; for (const byte of bytes) text += String.fromCharCode(byte); return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); },
  decode(text: string): Uint8Array { const plain = text.replace(/-/g, '+').replace(/_/g, '/'); return Uint8Array.from(atob(plain + '='.repeat((4 - (plain.length % 4)) % 4)), (char) => char.charCodeAt(0)); },
};
async function keyOf(ctx: RouteContext): ReturnType<typeof globalThis.crypto.subtle.importKey> {
  const stored = await ctx.keyFile('admin-confirm', () => ({ key: b64.encode(globalThis.crypto.getRandomValues(new Uint8Array(32))) }));
  return globalThis.crypto.subtle.importKey('raw', b64.decode(stored.key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
const text = (accountId: string, action: string, target: string, params: string, expires: number): Uint8Array => new TextEncoder().encode(`allworld-admin-confirm-v1\n${accountId}\n${action}\n${target}\n${params}\n${expires}`);

export async function issueConfirm(ctx: RouteContext, accountId: string, action: string, target: string, params: string): Promise<{ token: string; expiresAt: number }> {
  const expiresAt = ctx.now() + CONFIRM_TTL_MS;
  const signature = new Uint8Array(await globalThis.crypto.subtle.sign('HMAC', await keyOf(ctx), text(accountId, action, target, params, expiresAt)));
  return { token: `${expiresAt}.${b64.encode(signature)}`, expiresAt };
}
export async function checkConfirm(ctx: RouteContext, token: unknown, accountId: string, action: string, target: string, params: string): Promise<boolean> {
  const match = typeof token === 'string' ? /^(\d{10,16})\.([A-Za-z0-9_-]{43})$/.exec(token) : null;
  if (!match) return false;
  const expires = Number(match[1]);
  if (!(expires > ctx.now()) || expires > ctx.now() + CONFIRM_TTL_MS) return false;
  try { return await globalThis.crypto.subtle.verify('HMAC', await keyOf(ctx), b64.decode(match[2] ?? ''), text(accountId, action, target, params, expires)); } catch { return false; }
}
