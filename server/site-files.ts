/**
 * The site files that are served from code on both hosts (server/server.ts and deploy/cloudflare-worker.ts) instead of
 * being shipped as static assets: the release package only admits a fixed list of asset extensions, and neither
 * `.webmanifest`, `.xml` nor a `.well-known` folder is on it. One module, so the Node server and the Worker answer with the same bytes.
 * The files: the manifest, the sitemap and Digital Asset Links (/.well-known/assetlinks.json, for the Play Store wrapper: docs/STORE.md).
 *
 * robots.txt stays a static asset (public/robots.txt).
 */
import { SITE_ORIGIN } from './host-context.ts';
import { escapeHtml, sitemapPaths } from './path-meta.ts';

/** `status` is 200 when absent; assetlinks.json answers 404 itself while its setting is missing, so a host never falls through to the game's page for it. */
export interface SiteFile { type: string; body: string; status?: number }

const MANIFEST = `{
  "name": "Allworld",
  "short_name": "Allworld",
  "description": "A digital world to live in. Real-world places to explore: work, travel, make friends and play. Free in your browser, no download.",
  "id": "/",
  "start_url": "/?utm_source=pwa",
  "scope": "/",
  "display": "standalone",
  "orientation": "portrait",
  "lang": "en-NG",
  "categories": ["games", "social", "entertainment"],
  "background_color": "#183b2a",
  "theme_color": "#183b2a",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "/icons/icon-maskable-192.png", "sizes": "192x192", "type": "image/png", "purpose": "maskable" },
    { "src": "/icons/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ],
  "shortcuts": [
    { "name": "Map", "url": "/map", "icons": [{ "src": "/icons/shortcut-map-96.png", "sizes": "96x96", "type": "image/png" }] },
    { "name": "Messages", "url": "/messages", "icons": [{ "src": "/icons/shortcut-messages-96.png", "sizes": "96x96", "type": "image/png" }] },
    { "name": "Near you", "url": "/near", "icons": [{ "src": "/icons/shortcut-near-96.png", "sizes": "96x96", "type": "image/png" }] }
  ],
  "screenshots": [
    { "src": "/store/1-street-entry.png", "sizes": "1080x1920", "type": "image/png", "form_factor": "narrow", "label": "Walk your own street: the entry card over the world" },
    { "src": "/store/2-near-you.png", "sizes": "1080x1920", "type": "image/png", "form_factor": "narrow", "label": "Near you: posts from people confirmed in your area" },
    { "src": "/store/3-communities.png", "sizes": "1080x1920", "type": "image/png", "form_factor": "narrow", "label": "Communities: your city, your estate, your club" },
    { "src": "/store/4-world.png", "sizes": "1080x1920", "type": "image/png", "form_factor": "narrow", "label": "Your character at home in 3D Lagos" },
    { "src": "/store/5-map.png", "sizes": "1080x1920", "type": "image/png", "form_factor": "narrow", "label": "The Lagos map: real places, your home marked" }
  ]
}
`;

/** The Android package the Play Store wrapper (a Trusted Web Activity, docs/STORE.md) is published under. */
export const PLAY_PACKAGE_NAME = 'com.joinallworld.app';
/** The setting that carries the signing certificate fingerprint(s) of that package: one SHA-256 (AA:BB:… 32 pairs), or several separated by commas. */
export const PLAY_SIGNING_ENV = 'PLAY_SIGNING_SHA256';
const FINGERPRINT = /^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/;
const ASSETLINKS_PATH = '/.well-known/assetlinks.json';

/**
 * Digital Asset Links: the file Android reads to let the wrapper open the site without a browser bar. Nothing is published until the
 * owner has a Play signing key: with the setting unset, or holding anything that is not a SHA-256 fingerprint (a placeholder
 * included), the answer is null (a 404), never a file naming a certificate that is not ours. Pure: the host passes the one setting.
 */
export function assetLinks(setting: string | undefined): string | null {
  const prints = (setting ?? '').split(',').map((part) => part.trim().toUpperCase()).filter(Boolean);
  if (prints.length === 0 || !prints.every((print) => FINGERPRINT.test(print))) return null;
  const statement = { relation: ['delegate_permission/common.handle_all_urls'], target: { namespace: 'android_app', package_name: PLAY_PACKAGE_NAME, sha256_cert_fingerprints: [...new Set(prints)] } };
  return `${JSON.stringify([statement], null, 2)}\n`;
}

/** `origin` is the public origin (PUBLIC_ORIGIN, else the request's own host); empty falls back to the site's own. The games and every open city come from the registry (server/path-meta.ts). */
const sitemap = (origin: string): string => {
  const base = origin || SITE_ORIGIN;
  const rows = sitemapPaths().map((path) => `  <url><loc>${escapeHtml(`${base}${path}`)}</loc><changefreq>weekly</changefreq><priority>${path === '/games' ? '0.8' : '0.7'}</priority></url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${base}/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>
${rows.join('\n')}
</urlset>
`;
};

/** The file served at `pathname`, or undefined when the path is not one of these. `playSigning` is the PLAY_SIGNING_SHA256 setting (assetlinks.json only). */
export function siteFile(pathname: string, origin: string, playSigning?: string): SiteFile | undefined {
  if (pathname === '/manifest.webmanifest') return { type: 'application/manifest+json', body: MANIFEST };
  if (pathname === '/sitemap.xml') return { type: 'application/xml; charset=utf-8', body: sitemap(origin) };
  if (pathname === ASSETLINKS_PATH) {
    const body = assetLinks(playSigning);
    return body === null ? { type: 'application/json', body: '{"error":"not_found"}', status: 404 } : { type: 'application/json', body };
  }
  return undefined;
}
