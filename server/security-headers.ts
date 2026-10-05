/**
 * The security headers of every response, written once for both hosts (the Node server and the Worker).
 *
 * Three classes of response:
 *   app    the game's own HTML page (the home page, and every deep link, which is the same page). It runs the game, so
 *          its Content-Security-Policy admits the page's own scripts, the inline scripts index.html really contains
 *          (by hash, computed from the page as it is served, so the policy cannot drift from the page) and, only when
 *          telemetry is configured, the ingest hosts the browser then talks to.
 *   page   the small pages a module serves (the link preview /s/<code>, the e-mail pages /e/...). No script runs.
 *   api    JSON answers.
 *
 * Nothing here reads a request body or a secret. Strict-Transport-Security and upgrade-insecure-requests are only sent
 * for a request that came in over HTTPS to a real host: a developer's http://localhost must keep working.
 */
import type { TelemetryConfig } from './telemetry/config.ts';

/** What a host knows about the request that matters for the headers. */
export interface RequestFacts {
  /** The request came in over HTTPS (directly, or through a proxy the host trusts). */
  secure: boolean
  /** The host the browser used (name and optional port), for the WebSocket address. '' when unknown. */
  host?: string
}

const LOCAL = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\]|::1)$/i;
/** Whether a Host value (name, optional port) is this machine. */
export const isLocalHost = (host: string): boolean => LOCAL.test(host.replace(/:\d{1,5}$/, ''));
const production = (facts: RequestFacts): boolean => facts.secure && !isLocalHost(facts.host ?? '');

/** Browser features the game does not use are switched off; the microphone (voice) and the location (pick a local government, once) stay with the page itself. */
export const PERMISSIONS_POLICY = [
  'microphone=(self)', 'geolocation=(self)', 'camera=()', 'payment=()', 'usb=()', 'bluetooth=()', 'serial=()', 'hid=()',
  'midi=()', 'magnetometer=()', 'gyroscope=()', 'accelerometer=()', 'display-capture=()', 'interest-cohort=()',
].join(', ');

const BASE = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': PERMISSIONS_POLICY,
  'Cross-Origin-Opener-Policy': 'same-origin',
} as const;
const HSTS = 'max-age=31536000; includeSubDomains';

/** The scripts index.html contains inline, as CSP hash sources. A script with a src, and a data block (type="application/ld+json"), are not inline scripts. */
const SCRIPT_TAG = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
const JS_TYPES = new Set(['', 'module', 'text/javascript', 'application/javascript']);
const hashCache = new Map<string, Promise<string[]>>();
export function inlineScriptHashes(html: string): Promise<string[]> {
  let found = hashCache.get(html);
  if (!found) {
    if (hashCache.size >= 8) hashCache.clear();
    found = (async () => {
      const hashes: string[] = [];
      for (const [, attributes = '', body = ''] of html.matchAll(SCRIPT_TAG)) {
        if (/\ssrc\s*=/i.test(` ${attributes}`)) continue;
        const type = /\stype\s*=\s*["']?([^"'\s>]*)/i.exec(` ${attributes}`)?.[1]?.toLowerCase() ?? '';
        if (!JS_TYPES.has(type) || body === '') continue;
        const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body)));
        hashes.push(`'sha256-${btoa(String.fromCharCode(...digest))}'`);
      }
      return [...new Set(hashes)];
    })();
    hashCache.set(html, found);
  }
  return found;
}

/** The origins the browser sends telemetry to, from the same configuration the client is told (publicConfig): none when telemetry is off. */
export function telemetryOrigins(config: TelemetryConfig | null | undefined): string[] {
  if (!config?.active) return [];
  const origins = new Set<string>();
  const add = (value: string | undefined): void => { try { if (value) origins.add(new URL(value).origin); } catch { /* not a URL: nothing to allow */ } };
  add(config.sentryClient?.endpoint);
  add(config.posthog?.host);
  return [...origins];
}

export interface AppPolicy extends RequestFacts {
  /** From inlineScriptHashes(the page as served). */
  scriptHashes: readonly string[]
  /** From telemetryOrigins(config). */
  telemetry?: readonly string[]
}

/** The Content-Security-Policy of the game's page. */
export function appContentSecurityPolicy({ scriptHashes, telemetry = [], ...facts }: AppPolicy): string {
  const host = facts.host && /^[A-Za-z0-9.-]{1,253}(:\d{1,5})?$/.test(facts.host) ? facts.host : '';
  // 'self' covers a same-origin WebSocket in current browsers; older ones need the address spelled out.
  const sockets = host ? [`wss://${host}`, ...(facts.secure ? [] : [`ws://${host}`])] : [];
  const directives: string[] = [
    "default-src 'self'",
    `script-src 'self' ${scriptHashes.join(' ')}`.trim(),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src ${["'self'", ...sockets, ...telemetry].join(' ')}`,
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
  ];
  if (production(facts)) directives.push('upgrade-insecure-requests');
  return directives.join('; ');
}

/** The policy of the module pages: no script, no frame, a style written into the page, a form that posts back to this site. */
export const PAGE_CONTENT_SECURITY_POLICY = "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

const hsts = (facts: RequestFacts): Record<string, string> => (production(facts) ? { 'Strict-Transport-Security': HSTS } : {});

/** Headers of the game's page (the Content-Type and caching are the host's). */
export function appHeaders(policy: AppPolicy): Record<string, string> {
  return { ...BASE, ...hsts(policy), 'Content-Security-Policy': appContentSecurityPolicy(policy) };
}

/** Headers of a page a module serves. A page cannot change them. */
export function pageHeaders(facts: RequestFacts): Record<string, string> {
  return {
    'Content-Type': 'text/html; charset=utf-8', ...BASE, 'Referrer-Policy': 'no-referrer', ...hsts(facts), 'X-Robots-Tag': 'noindex, nofollow',
    'Content-Security-Policy': production(facts) ? `${PAGE_CONTENT_SECURITY_POLICY}; upgrade-insecure-requests` : PAGE_CONTENT_SECURITY_POLICY,
  };
}

/** Headers every JSON answer carries (a route may still set Cache-Control, Set-Cookie and Retry-After). */
export function apiHeaders(facts: RequestFacts): Record<string, string> {
  return { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin', ...hsts(facts) };
}

/** The same facts from a Fetch API request (the Worker). */
export function factsOfUrl(url: URL): RequestFacts {
  return { secure: url.protocol === 'https:', host: url.host };
}
