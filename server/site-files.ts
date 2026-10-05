/**
 * The two site files that are served from code on both hosts (server/server.ts and deploy/cloudflare-worker.ts) instead of
 * being shipped as static assets: the release package only admits a fixed list of asset extensions, and neither
 * `.webmanifest` nor `.xml` is on it. One module, so the Node server and the Worker answer with the same bytes.
 *
 * robots.txt stays a static asset (public/robots.txt).
 */
import { SITE_ORIGIN } from './host-context.ts';

export interface SiteFile { type: string; body: string }

const MANIFEST = `{
  "name": "Allworld",
  "short_name": "Allworld",
  "description": "A digital world to live in. Explore cities and cultures, work, travel and make friends. Nine cities are open, from Lagos to Kano; more places are opening. Free in your browser.",
  "id": "/",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "orientation": "portrait",
  "lang": "en-NG",
  "categories": ["games", "entertainment"],
  "background_color": "#183b2a",
  "theme_color": "#183b2a",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "/icons/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
`;

/** `origin` is the public origin (PUBLIC_ORIGIN, else the request's own host); empty falls back to the site's own. */
const sitemap = (origin: string): string => `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${origin || SITE_ORIGIN}/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>
</urlset>
`;

/** The file served at `pathname`, or undefined when the path is not one of the two. */
export function siteFile(pathname: string, origin: string): SiteFile | undefined {
  if (pathname === '/manifest.webmanifest') return { type: 'application/manifest+json', body: MANIFEST };
  if (pathname === '/sitemap.xml') return { type: 'application/xml; charset=utf-8', body: sitemap(origin) };
  return undefined;
}
