/**
 * OWNER: admin
 * THE ADMIN ADDRESS (docs/ADMIN.md, "Using admin.<domain>"). The same server answers on a second host name, `admin.<domain>`, with a
 * much smaller face: only the admin page (a separate, lean build entry that carries no game), its own files, and the few routes the page
 * needs. Both hosts (server/server.ts and deploy/cloudflare-worker.ts) decide with the functions here, so they cannot drift apart.
 * Portable: no Node imports.
 *
 *   which host is it      ADMIN_HOST names it (one host name, no scheme); unset: `admin.` + the host of PUBLIC_ORIGIN (else of the site's own
 *                         origin) without a leading `www.`. `admin.localhost` is always the admin address, for trying it on one machine.
 *   what it answers       GET /api/health · GET /api/session · /api/account[/...] · /api/admin/... · robots.txt (everything disallowed) ·
 *                         /assets/... and the favicon · and, for any other GET, the admin page. Everything else is a plain 404 (a
 *                         wrong method is 405): no game page, no sockets, no manifest, no sitemap, no link previews, no game routes. Its
 *                         session is its own: the cookie is host-only, so signing in here never signs anyone in on the game.
 *   its limits            every address is counted under its own name on this host (`adminAddress`), so what a person does on the
 *                         game never spends their allowance here, and a flood here never spends the game's.
 */
import { SITE_ORIGIN } from '../host-context.ts';

export const ADMIN_HOST_ENV = 'ADMIN_HOST';
const HOST_NAME = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;

const nameOf = (host: unknown): string => String(host ?? '').trim().toLowerCase().replace(/:\d{1,5}$/, '').replace(/\.$/, '');

/** The admin host name in force: ADMIN_HOST when it is a plain host name, else `admin.` + the public host. '' when there is none. */
export function adminHostName(setting: unknown, publicOrigin: string): string {
  const given = nameOf(setting);
  if (given) return HOST_NAME.test(given) ? given : '';
  let base = '';
  try { base = new URL(publicOrigin || SITE_ORIGIN).hostname.toLowerCase(); } catch { /* none */ }
  base = base.replace(/^www\./, '');
  const made = base && !/^\d+(\.\d+){3}$/.test(base) && base.includes('.') ? `admin.${base}` : '';
  return HOST_NAME.test(made) ? made : '';
}

/** Is this Host header the admin address? (`admin.localhost` always; the configured name on any port.) */
export function isAdminHost(host: unknown, configured: string): boolean {
  const name = nameOf(host);
  if (!name) return false;
  return name === 'admin.localhost' || (configured !== '' && name === configured);
}

/** What the admin host does with a request. */
export type AdminHostRoute = 'api' | 'robots' | 'asset' | 'shell' | 'notfound' | 'method';
const API_EXACT = new Set(['/api/health', '/api/session']);
export function adminHostRoute(method: string, pathname: string): AdminHostRoute {
  if (pathname.startsWith('/api/') || pathname === '/api') {
    if (pathname === '/api/session') return method === 'GET' ? 'api' : 'notfound';
    if (API_EXACT.has(pathname)) return method === 'GET' || method === 'HEAD' ? 'api' : 'notfound';
    if (pathname === '/api/account' || pathname.startsWith('/api/account/') || pathname.startsWith('/api/admin/')) return 'api';
    return 'notfound';
  }
  if (pathname === '/socket' || pathname === '/manifest.webmanifest' || pathname === '/sitemap.xml' || pathname === '/sw.js' || pathname.startsWith('/s/') || pathname.startsWith('/e/')) return 'notfound';
  if (method !== 'GET' && method !== 'HEAD') return 'method';
  if (pathname === '/robots.txt') return 'robots';
  if (pathname.startsWith('/assets/') || pathname === '/favicon.svg') return 'asset';
  return 'shell';
}

export const ADMIN_ROBOTS = 'User-agent: *\nDisallow: /\n';
/** The file the admin page is built into (vite.config.ts), served for every page request on the admin host. */
export const ADMIN_SHELL = 'adminshell.html';
/** A request's address as this host counts it: its own bucket, apart from the game's. */
export const adminAddress = (address: string): string => `admin:${address}`;
