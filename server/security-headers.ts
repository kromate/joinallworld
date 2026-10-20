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
import type { AccountsConfig } from './types.ts';
import { accountsCspAdditions } from './accounts/csp.ts';

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

/**
 * CLOUDFLARE'S WEB ANALYTICS BEACON. When the site is served through Cloudflare with Web Analytics on, Cloudflare injects
 * `https://static.cloudflareinsights.com/beacon.min.js/…` into the page at the edge, and that script posts to
 * `https://cloudflareinsights.com/cdn-cgi/rum`. The page's own source never contains either, so they are allowed here, by
 * origin and nowhere else: one script host and one connect host. Everything else of the policy stays strict.
 */
export const BEACON_SCRIPT = 'https://static.cloudflareinsights.com';
export const BEACON_CONNECT = 'https://cloudflareinsights.com';

export interface AppPolicy extends RequestFacts {
  /** From inlineScriptHashes(the page as served). */
  scriptHashes: readonly string[]
  /** From telemetryOrigins(config). */
  telemetry?: readonly string[]
  /** The sign-in configuration (host-context.ts accountsConfig). Unset or null: accounts are off and the policy is the strict one. */
  accounts?: AccountsConfig | null
  /** This entry declares the compressed avatar decoder and embedded GLB textures. */
  avatarAssets?: boolean
  trustProviders?: { phone: boolean; id: boolean }
  /** The admin address's page (server/admin/host.ts): no analytics beacon, no telemetry hosts, and the microphone and location are off. */
  admin?: boolean
}

/** The player of a space's screen (src/spaces/screen.ts embedUrl): YouTube's privacy-enhanced embed. */
export const SCREEN_FRAME = 'https://www.youtube-nocookie.com';

/** The Content-Security-Policy of the game's page. */
export function appContentSecurityPolicy({ scriptHashes, telemetry = [], accounts = null, trustProviders, avatarAssets = false, admin = false, ...facts }: AppPolicy): string {
  const host = facts.host && /^[A-Za-z0-9.-]{1,253}(:\d{1,5})?$/.test(facts.host) ? facts.host : '';
  // 'self' covers a same-origin WebSocket in current browsers; older ones need the address spelled out.
  const sockets = host ? [`wss://${host}`, ...(facts.secure ? [] : [`ws://${host}`])] : [];
  const extra = accountsCspAdditions(accounts).csp;
  if (!admin && trustProviders?.phone) {
    extra['script-src'].push('https://www.google.com/recaptcha/', 'https://www.gstatic.com/recaptcha/');
    extra['frame-src'].push('https://www.google.com/recaptcha/', 'https://recaptcha.google.com/recaptcha/');
    extra['connect-src'].push('https://www.google.com/recaptcha/');
  }
  if (!admin && trustProviders?.id) {
    extra['script-src'].push('https://widget.dojah.io/widget.js');
    extra['frame-src'].push('https://identity.dojah.io', 'https://widget.dojah.io');
    extra['connect-src'].push('https://widget.dojah.io', 'https://identity.dojah.io');
  }
  const directives: string[] = [
    "default-src 'self'",
    `script-src ${["'self'", ...scriptHashes, ...(!admin && avatarAssets ? ["'wasm-unsafe-eval'"] : []), ...(admin ? [] : [BEACON_SCRIPT]), ...extra['script-src']].join(' ')}`,
    `style-src ${["'self'", "'unsafe-inline'", ...extra['style-src']].join(' ')}`,
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src ${["'self'", ...(!admin && avatarAssets ? ['blob:'] : []), ...(admin ? [] : [...sockets, ...telemetry, BEACON_CONNECT]), ...extra['connect-src']].join(' ')}`,
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    // A frame-src replaces default-src for frames, so it keeps 'self': a 3D space's script sandbox (/sandbox/space.html) is framed from here.
    // The screen in a space (docs/WORLDS.md phase 2) is YouTube's privacy-enhanced player and nothing else from YouTube: no script, no connect.
    ...(admin ? (extra['frame-src'].length ? [`frame-src ${["'self'", ...extra['frame-src']].join(' ')}`] : []) : [`frame-src ${["'self'", SCREEN_FRAME, ...extra['frame-src']].join(' ')}`]),
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

interface PageRequestContext {
  pathname: string
  status: number
  method: string
}

/** Headers of the game's page (the Content-Type and caching are the host's). */
export function appHeaders(policy: AppPolicy): Record<string, string> {
  if (policy.admin) return adminHeaders(policy);
  return { ...BASE, ...(policy.trustProviders?.id && !policy.admin ? { 'Permissions-Policy': PERMISSIONS_POLICY.replace('camera=()', 'camera=("https://identity.dojah.io" "https://widget.dojah.io")') } : {}), 'Cross-Origin-Opener-Policy': accountsCspAdditions(policy.accounts).coop, ...hsts(policy), 'Content-Security-Policy': appContentSecurityPolicy(policy) };
}

/**
 * Headers of the admin address's page and files: the game's policy without the analytics beacon, the telemetry hosts and the sockets, no
 * referrer, no microphone or location, never kept, never indexed, never framed.
 */
export function adminHeaders(policy: AppPolicy): Record<string, string> {
  return {
    ...BASE, 'Referrer-Policy': 'no-referrer', 'Permissions-Policy': PERMISSIONS_POLICY.replace('microphone=(self)', 'microphone=()').replace('geolocation=(self)', 'geolocation=()'),
    'Cross-Origin-Opener-Policy': accountsCspAdditions(policy.accounts).coop, ...hsts(policy), 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'no-store',
    'Content-Security-Policy': appContentSecurityPolicy({ ...policy, admin: true }),
  };
}

/** Headers of a page a module serves. A page cannot change them. */
export function pageHeaders(facts: RequestFacts, context?: PageRequestContext): Record<string, string> {
  const indexable = context !== undefined
    && /^\/(?:features|pages|skills)\/?$/.test(context.pathname)
    && context.status === 200
    && (context.method === 'GET' || context.method === 'HEAD');
  return {
    'Content-Type': 'text/html; charset=utf-8', ...BASE, 'Referrer-Policy': 'no-referrer', ...hsts(facts), 'X-Robots-Tag': indexable ? 'index, follow' : 'noindex, nofollow',
    'Content-Security-Policy': production(facts) ? `${PAGE_CONTENT_SECURITY_POLICY}; upgrade-insecure-requests` : PAGE_CONTENT_SECURITY_POLICY,
  };
}

/** Headers every JSON answer carries (a route may still set Cache-Control, Set-Cookie and Retry-After). */
/**
 * THE SCRIPT SANDBOX's headers (public/sandbox/, docs/SPACES-3D.md phase 4). The page runs players' own code, so it may load its
 * own script and make a worker from a blob, and nothing else: no network, no pictures, no styles, no frames, no forms. It may be
 * framed only by the game's own page, which frames it with `sandbox="allow-scripts"` (an opaque origin: no cookies, no storage).
 */
export const SANDBOX_CONTENT_SECURITY_POLICY = [
  "default-src 'none'", "script-src 'self'", 'worker-src blob:', "connect-src 'none'", "img-src 'none'", "style-src 'none'", "font-src 'none'",
  "media-src 'none'", "frame-src 'none'", "object-src 'none'", "form-action 'none'", "base-uri 'none'", "frame-ancestors 'self'",
].join('; ');
export const sandboxHeaders = (): Record<string, string> => ({
  'Content-Security-Policy': SANDBOX_CONTENT_SECURITY_POLICY, 'X-Frame-Options': 'SAMEORIGIN', 'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer', 'Permissions-Policy': PERMISSIONS_POLICY.replace('microphone=(self)', 'microphone=()').replace('geolocation=(self)', 'geolocation=()'),
  'Cache-Control': 'no-cache',
});
/** Whether a path is the script sandbox's (served with sandboxHeaders, never the game's page headers). */
export const isSandboxPath = (path: string): boolean => /^\/sandbox\/space\.(?:html|js)$/.test(path);

/** Cache-Control for bytes a route hands over (RouteResult.file): private always; `immutable` for content named by its own hash (a player's model). */
export const fileCache = (cache: 'no-store' | 'immutable' | undefined): string => (cache === 'immutable' ? 'private, max-age=604800, immutable' : cache ?? 'private, max-age=300');
export function apiHeaders(facts: RequestFacts): Record<string, string> {
  return { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin', ...hsts(facts) };
}

/** The same facts from a Fetch API request (the Worker). */
export function factsOfUrl(url: URL): RequestFacts {
  return { secure: url.protocol === 'https:', host: url.host };
}
