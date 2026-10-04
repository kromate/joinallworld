/**
 * OWNER: growth
 * The mail provider adapter: Zoho ZeptoMail, through its SendGrid-compatible endpoint. The only
 * file that knows the provider. It uses ctx.fetch (no library) and the settings ctx.env exposes:
 *   ZEPTOMAIL_AUTH       the full value of the Authorization header, as ZeptoMail issues it
 *                        ("Zoho-enczapikey …"). Never logged, stored or returned.
 *   EMAIL_FROM_ADDRESS   an address on a domain verified in ZeptoMail (SPF, DKIM and DMARC set up)
 *   EMAIL_FROM_NAME      the display name, default "Allworld"
 * With either of the first two unset the adapter reports `configured: false` and the caller runs
 * in dry-run: the message is rendered and kept as a preview, and nothing leaves the server.
 *
 * send() never throws. A 4xx is never retried (the request itself is wrong); a 429, a 5xx and a
 * network failure are retried up to RETRIES times with a growing pause. The caller makes sure one
 * message is attempted once per recipient and period, so a retry here cannot become a duplicate.
 */
export const ENDPOINT = 'https://api.zeptomail.com/v1.1/sg/email';
export const RETRIES = 3, TIMEOUT_MS = 10000;
import type { RouteContext } from '../../types.ts';
import { outboundResponse } from '../data.ts';
const ADDRESS = /^[^\s@<>]{1,64}@[a-z0-9.-]{3,253}$/i;

export function mailConfig(ctx: Pick<RouteContext, 'env'>): { configured: boolean; auth: string; from: string; name: string } {
  const auth = ctx.env('ZEPTOMAIL_AUTH'), from = ctx.env('EMAIL_FROM_ADDRESS').trim();
  const name = (ctx.env('EMAIL_FROM_NAME') || 'Allworld').replace(/[\r\n"<>]/g, '').slice(0, 60);
  return { configured: Boolean(auth) && ADDRESS.test(from), auth, from, name };
}

/**
 * @param {{ to: string, subject: string, text: string, html: string, headers?: Record<string, string> }} message
 * @returns {Promise<{ ok: boolean, status: number, attempts: number, error?: string }>}  `error` is a short code, never a body
 */
export interface MailMessage { to: string; subject: string; text: string; html: string; headers?: Record<string, string> }
export async function sendMail(ctx: Pick<RouteContext, 'env' | 'fetch'>, message: MailMessage, { pause = (ms: number) => new Promise<void>((done) => setTimeout(done, ms)) }: { pause?: (ms: number) => Promise<void> } = {}): Promise<{ ok: boolean; status: number; attempts: number; error?: string }> {
  const config = mailConfig(ctx);
  if (!config.configured) return { ok: false, status: 0, attempts: 0, error: 'not_configured' };
  const body = JSON.stringify({
    personalizations: [{ to: [{ email: message.to }] }], from: { email: config.from, name: config.name }, subject: message.subject,
    content: [{ type: 'text/plain', value: message.text }, { type: 'text/html', value: message.html }], ...(message.headers ? { headers: message.headers } : {}),
  });
  let status = 0, error = 'network';
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      const response = outboundResponse(await ctx.fetch(ENDPOINT, { method: 'POST', body, signal: globalThis.AbortSignal?.timeout?.(TIMEOUT_MS),
        headers: { Authorization: config.auth, 'Content-Type': 'application/json', Accept: 'application/json' } }));
      status = response.status;
      if (status >= 200 && status < 300) return { ok: true, status, attempts: attempt };
      error = `http_${status}`;
      if (status < 500 && status !== 429) return { ok: false, status, attempts: attempt, error };
      const wait = Number(response.headers?.get('retry-after'));
      if (attempt < RETRIES) await pause(Number.isFinite(wait) && wait > 0 ? Math.min(wait, 10) * 1000 : 500 * 4 ** (attempt - 1));
    } catch (thrown) {
      const thrownName = thrown instanceof Error ? thrown.name : undefined;
      status = 0; error = thrownName === 'TimeoutError' || thrownName === 'AbortError' ? 'timeout' : 'network';
      if (attempt < RETRIES) await pause(500 * 4 ** (attempt - 1));
    }
  }
  return { ok: false, status, attempts: RETRIES, error };
}
