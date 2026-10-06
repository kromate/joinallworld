/**
 * The static head of the game's page and the files a crawler fetches: what index.html says about the game, that its
 * JSON-LD parses, that the share image really is 1200x630 and small, and that the manifest and robots files agree.
 */
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { test } from 'node:test';
import { absolutePreviewImage, SITE_ORIGIN } from './host-context.ts';
import { siteFile } from './site-files.ts';

const root = new URL('../', import.meta.url);
const read = (path: string): Promise<string> => readFile(new URL(path, root), 'utf8');
const tag = (html: string, key: string): string | undefined => new RegExp(`<meta (?:property|name)="${key}" content="([^"]*)"`).exec(html)?.[1];

test('index.html head: one title, one description, a canonical, Open Graph and Twitter tags, robots, icons', async () => {
  const html = await read('index.html'), head = html.slice(0, html.indexOf('</head>'));
  assert.match(html, /^<!doctype html><html lang="en">/);
  const titles = [...head.matchAll(/<title>([^<]*)<\/title>/g)].map(match => match[1] ?? '');
  assert.equal(titles.length, 1);
  assert.ok((titles[0] ?? '').length > 10 && (titles[0] ?? '').length <= 60, titles[0]);
  const description = tag(head, 'description') ?? '';
  assert.ok(description.length > 50 && description.length <= 155, `${description.length}`);
  assert.ok(!/joinallworld/i.test(head.replace(/https:\/\/joinallworld\.com/g, '')), 'the player-visible name is Allworld');
  assert.equal(tag(head, 'robots'), 'index,follow');
  assert.equal(tag(head, 'theme-color'), '#183b2a');
  assert.match(head, new RegExp(`<link rel="canonical" href="${SITE_ORIGIN}/">`));
  const og = Object.fromEntries(['og:title', 'og:description', 'og:type', 'og:url', 'og:site_name', 'og:locale', 'og:image', 'og:image:width', 'og:image:height', 'og:image:alt'].map(key => [key, tag(head, key)]));
  assert.deepEqual([og['og:type'], og['og:url'], og['og:site_name'], og['og:locale'], og['og:image'], og['og:image:width'], og['og:image:height']],
    ['website', `${SITE_ORIGIN}/`, 'Allworld', 'en_NG', `${SITE_ORIGIN}/og/allworld.png`, '1200', '630']);
  assert.equal(og['og:title'], titles[0]); assert.equal(og['og:description'], description); assert.ok(og['og:image:alt']);
  assert.deepEqual([tag(head, 'twitter:card'), tag(head, 'twitter:title'), tag(head, 'twitter:description'), tag(head, 'twitter:image')], ['summary_large_image', titles[0], description, `${SITE_ORIGIN}/og/allworld.png`]);
  for (const rel of ['manifest', 'icon', 'apple-touch-icon']) assert.match(head, new RegExp(`<link rel="${rel}" href="/`));
  assert.match(head, /href="\/favicon\.svg" type="image\/svg\+xml"/); assert.match(head, /href="\/icons\/favicon-32\.png" type="image\/png"/);
  assert.match(html, /<noscript>.*Allworld.*Lagos.*<\/noscript>/);
  assert.ok(!/Lagos life/i.test(head), 'the home page head does not present the game as a Lagos life'); assert.ok(!/Lagos/.test(titles[0] ?? ''), 'the title leads with the world, not a city');
  assert.ok(!/Lagos/.test(og['og:image:alt'] ?? ''), 'the share image does not mention Lagos');
});

test('index.html JSON-LD parses: a VideoGame and a WebSite', async () => {
  const html = await read('index.html');
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([^<]*)<\/script>/g)].map(match => JSON.parse(match[1] ?? '') as Record<string, unknown>[]);
  const [game, site] = blocks.flat();
  assert.equal(blocks.length, 1);
  assert.ok(game && site);
  assert.deepEqual([game['@type'], game.name, game.gamePlatform, game.applicationCategory, game.operatingSystem, game.inLanguage], ['VideoGame', 'Allworld', 'Web browser', 'Game', 'Any', 'en']);
  assert.deepEqual([(game.offers as { price: string }).price, game.url, game.image], ['0', `${SITE_ORIGIN}/`, `${SITE_ORIGIN}/og/allworld.png`]);
  assert.ok(typeof game.description === 'string' && game.genre);
  assert.deepEqual([site['@type'], site.name, site.url], ['WebSite', 'Allworld', `${SITE_ORIGIN}/`]);
  assert.equal(JSON.stringify(blocks).includes('"price":"0"'), true);
});

test('the host writes the page for its own origin: canonical, og:url, og:image and JSON-LD', async () => {
  const html = await read('index.html'), local = absolutePreviewImage(html, 'http://localhost:3699');
  assert.ok(!local.includes('joinallworld.com'));
  assert.match(local, /<link rel="canonical" href="http:\/\/localhost:3699\/">/);
  assert.equal(tag(local, 'og:image'), 'http://localhost:3699/og/allworld.png');
  const ld = /<script type="application\/ld\+json">([^<]*)<\/script>/.exec(local)?.[1] ?? '';
  assert.doesNotThrow(() => JSON.parse(ld));
  assert.equal(absolutePreviewImage(html, ''), html, 'with no origin the page is unchanged');
});

test('the sitemap and the manifest are code, not files: the release package admits neither extension', async () => {
  for (const name of ['sitemap.xml', 'manifest.webmanifest']) await assert.rejects(stat(new URL(`public/${name}`, root)), { code: 'ENOENT' }, name);
  assert.match(await read('index.html'), /<link rel="manifest" href="\/manifest\.webmanifest">/);
  assert.deepEqual([siteFile('/manifest.webmanifest', '')?.type, siteFile('/sitemap.xml', '')?.type, siteFile('/robots.txt', ''), siteFile('/sitemap.xml/', '')], ['application/manifest+json', 'application/xml; charset=utf-8', undefined, undefined]);
  assert.ok(siteFile('/sitemap.xml', 'https://play.example')?.body.includes('<loc>https://play.example/</loc>'));
  assert.ok(siteFile('/sitemap.xml', '')?.body.includes(`<loc>${SITE_ORIGIN}/</loc>`), 'with no usable origin the site\'s own is named');
});

test('public files: robots.txt, sitemap.xml, manifest and the images they name', async () => {
  const robots = await read('public/robots.txt'), sitemap = siteFile('/sitemap.xml', SITE_ORIGIN)?.body ?? '';
  assert.match(robots, /^User-agent: \*\nAllow: \/\n/); assert.match(robots, /Disallow: \/api\/\nDisallow: \/s\/\nDisallow: \/e\//);
  assert.match(robots, new RegExp(`Sitemap: ${SITE_ORIGIN}/sitemap\\.xml`));
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
  assert.equal(locs[0], `${SITE_ORIGIN}/`);
  assert.ok(locs.includes(`${SITE_ORIGIN}/games`) && locs.includes(`${SITE_ORIGIN}/abuja`), 'the games and the open cities are listed (server/path-meta.test.ts checks them all)');
  const manifest = JSON.parse(siteFile('/manifest.webmanifest', '')?.body ?? '') as { name: string; short_name: string; lang: string; start_url: string; display: string; theme_color: string; background_color: string; icons: { src: string; purpose: string; sizes: string }[] };
  assert.deepEqual([manifest.name, manifest.short_name, manifest.lang, manifest.start_url, manifest.display, manifest.theme_color, manifest.background_color], ['Allworld', 'Allworld', 'en-NG', '/', 'standalone', '#183b2a', '#183b2a']);
  assert.ok(manifest.icons.some(icon => icon.purpose === 'maskable') && manifest.icons.some(icon => icon.purpose === 'any' && icon.sizes === '512x512') && manifest.icons.some(icon => icon.sizes === '192x192'));
  for (const icon of manifest.icons) assert.ok((await stat(new URL(`public${icon.src}`, root))).size > 0, icon.src);
  const png = await readFile(new URL('public/og/allworld.png', root));
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [1200, 630]);
  assert.ok(png.length < 300 * 1024, `${png.length} bytes`);
});

test('the workshop pages are not for search engines', async () => {
  for (const page of ['campus.html', 'models.html', 'voice-test.html']) assert.match(await read(page), /<meta name="robots" content="noindex,nofollow">/, page);
});

test('the page, the manifest and the readme say which cities are open, and say it the same way', async () => {
  const html = await read('index.html'), head = html.slice(0, html.indexOf('</head>'));
  const manifest = (JSON.parse(siteFile('/manifest.webmanifest', '')?.body ?? '') as { description: string }).description;
  const description = tag(head, 'description') ?? '';
  for (const text of [description, tag(head, 'og:description') ?? '', tag(head, 'twitter:description') ?? '', manifest]) {
    assert.match(text, /Nine cities are open, from Lagos to Kano; more places are opening\./, text);
  }
  assert.ok(description.length <= 155 && ((/<title>([^<]*)<\/title>/.exec(head)?.[1] ?? '').length <= 60), 'title at most 60 and description at most 155 characters');
  assert.match(html, /<noscript>[^]*nine cities of Nigeria, from Lagos to Abuja and Kano[^]*<\/noscript>/);
  for (const [name, text] of [['index.html', html], ['manifest', manifest], ['README.md', await read('README.md')], ['CONTRIBUTING.md', await read('CONTRIBUTING.md')]] as const) {
    assert.ok(!/two cities|Lagos and Ibadan are open|first two cities|more cities (are )?coming/i.test(text), `${name} does not claim only two cities are open`);
  }
  assert.match(await read('README.md'), /Today nine cities are open: Lagos, Ibadan, Ogun's cities \(Abeokuta, Ota, Ijebu-Ode and Sagamu\), Port Harcourt, Abuja and Kano/);
});
