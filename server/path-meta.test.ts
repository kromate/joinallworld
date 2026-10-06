/**
 * The head of the page for a short address, on the Node host (the Worker's twin is in deploy/cloudflare.test.ts): the title,
 * description, Open Graph and Twitter tags, the canonical address and robots line per path; escaping; the script hashes of
 * the Content-Security-Policy staying the same for every address; and the sitemap, which comes from the city registry.
 */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { GAME_SLUGS, knownStateIds, openCitiesOf, openCityIds, placeFacts } from '../src/paths.ts';
import { SITE_ORIGIN } from './host-context.ts';
import { escapeHtml, metaFor, sitemapPaths, withPathMeta } from './path-meta.ts';
import { inlineScriptHashes } from './security-headers.ts';
import { siteFile } from './site-files.ts';
import { fixture } from './test-fixture.ts';

const INDEX = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const tag = (html: string, key: string): string | undefined => new RegExp(`<meta (?:property|name)="${key}" content="([^"]*)"`).exec(html)?.[1];
const title = (html: string): string | undefined => /<title>([^<]*)<\/title>/.exec(html)?.[1];
const canonical = (html: string): string | undefined => /<link rel="canonical" href="([^"]*)">/.exec(html)?.[1];
/** What a page says about itself, in every place it says it. */
const head = (html: string) => ({ title: title(html), description: tag(html, 'description'), ogTitle: tag(html, 'og:title'), ogDescription: tag(html, 'og:description'), ogUrl: tag(html, 'og:url'), twTitle: tag(html, 'twitter:title'), twDescription: tag(html, 'twitter:description'), canonical: canonical(html), robots: tag(html, 'robots'), image: tag(html, 'og:image') });

test('the home page keeps its own head; the address / is not rewritten', () => {
  assert.equal(withPathMeta(INDEX, '/'), INDEX);
  assert.equal(withPathMeta(INDEX, ''), INDEX);
  assert.equal(metaFor('/'), null);
})

test('the games pages: title, description, canonical, Open Graph and Twitter tags all agree', () => {
  const hub = head(withPathMeta(INDEX, '/games'));
  assert.equal(hub.title, 'Play chess, the daily word and more — Allworld');
  assert.equal(hub.canonical, `${SITE_ORIGIN}/games`);
  assert.deepEqual([hub.ogTitle, hub.twTitle], [hub.title, hub.title]);
  assert.deepEqual([hub.ogDescription, hub.twDescription], [hub.description, hub.description]);
  assert.equal(hub.ogUrl, `${SITE_ORIGIN}/games`);
  assert.equal(hub.robots, 'index,follow');
  assert.equal(hub.image, `${SITE_ORIGIN}/og/allworld.png`, 'the existing preview image is reused');
  for (const game of GAME_SLUGS) { const page = head(withPathMeta(INDEX, `/games/${game}`)); assert.equal(page.canonical, `${SITE_ORIGIN}/games/${game}`); assert.notEqual(page.title, hub.title, game); assert.match(page.title ?? '', /— Allworld$/) }
  // Aliases are one page under one address.
  for (const alias of ['/play', '/Games/']) assert.equal(head(withPathMeta(INDEX, alias)).canonical, `${SITE_ORIGIN}/games`, alias);
  assert.equal(head(withPathMeta(INDEX, '/word')).canonical, `${SITE_ORIGIN}/games/oro`);
  assert.equal(head(withPathMeta(INDEX, '/chess')).canonical, `${SITE_ORIGIN}/games/chess`);
})

test('every open city: "Live in <City> — Allworld", a description from the city, a canonical of its own', () => {
  for (const id of openCityIds()) {
    const rules = placeFacts(id);
    assert.ok(rules);
    const page = head(withPathMeta(INDEX, `/${id}`));
    assert.equal(page.title, `Live in ${rules.name} — Allworld`);
    assert.ok((page.description ?? '').startsWith(rules.teaser.slice(0, 40)), id);
    assert.equal(page.canonical, `${SITE_ORIGIN}/${id}`);
    assert.equal(page.ogUrl, `${SITE_ORIGIN}/${id}`);
    assert.equal(page.robots, 'index,follow');
  }
  assert.equal(head(withPathMeta(INDEX, '/abuja')).title, 'Live in Abuja — Allworld');
  assert.equal(head(withPathMeta(INDEX, '/fct')).canonical, `${SITE_ORIGIN}/abuja`, 'a state with one open city is that city');
  assert.equal(head(withPathMeta(INDEX, '/ph')).canonical, `${SITE_ORIGIN}/port-harcourt`, 'an alias points at the one address');
  assert.equal(head(withPathMeta(INDEX, '/abuja/games')).title, 'Games in Abuja — Allworld');
  assert.equal(head(withPathMeta(INDEX, '/abuja/some-venue')).canonical, `${SITE_ORIGIN}/abuja`, 'a venue the host cannot check is the city page');
})

test('a state with several open cities, and a capital that opened', () => {
  const ogun = head(withPathMeta(INDEX, '/ogun'));
  assert.equal(ogun.title, 'Ogun State — Allworld');
  assert.ok((ogun.description ?? '').includes('Abeokuta'));
  // Every state now has an open city, so /kaduna is Kaduna's city page rather than a state page that says it is coming.
  assert.equal(head(withPathMeta(INDEX, '/kaduna')).title, 'Live in Kaduna — Allworld');
  assert.equal(head(withPathMeta(INDEX, '/nigeria')).canonical, `${SITE_ORIGIN}/nigeria`);
})

test('unknown paths, panels and reserved ones: the default head and noindex', () => {
  const base = head(INDEX);
  for (const path of ['/nowhere', '/some/deep/link', '/signup', '/messages', '/admin', '/index.html', '/a.png', '/games//x']) {
    const page = head(withPathMeta(INDEX, path));
    assert.equal(page.robots, 'noindex,follow', path);
    assert.deepEqual([page.title, page.description, page.canonical], [base.title, base.description, base.canonical], path);
  }
})

test('every title and description fits a search result, and every value is escaped', () => {
  for (const path of ['/games', ...GAME_SLUGS.map((game) => `/games/${game}`), ...openCityIds().flatMap((id) => [`/${id}`, `/${id}/games`]), ...knownStateIds().map((state) => `/${state}`), '/nigeria', '/world']) {
    const page = head(withPathMeta(INDEX, path));
    assert.ok((page.title ?? '').length > 10 && (page.title ?? '').length <= 60, `${path}: ${page.title}`);
    assert.ok((page.description ?? '').length > 50 && (page.description ?? '').length <= 155, `${path}: ${(page.description ?? '').length}`);
  }
  assert.equal(escapeHtml(`<script>"a" & 'b'</script>`), '&lt;script&gt;&quot;a&quot; &amp; &#39;b&#39;&lt;/script&gt;');
  // A value is data, never markup, never a replacement pattern: the page keeps exactly one of each tag.
  const page = withPathMeta(INDEX, '/abuja');
  assert.equal(page.match(/<title>/g)?.length, 1);
  assert.equal(page.match(/<link rel="canonical"/g)?.length, 1);
  assert.equal(page.match(/<meta name="description"/g)?.length, 1);
  assert.ok(!page.includes('$&') && !page.includes('undefined'));
})

test('the origin of the host is written into the canonical address, og:url and only those', () => {
  const page = withPathMeta(INDEX, '/kano', 'https://play.example');
  assert.equal(canonical(page), 'https://play.example/kano');
  assert.equal(tag(page, 'og:url'), 'https://play.example/kano');
  assert.equal(page.replaceAll('https://play.example/kano', '').includes('https://play.example'), false);
})

test('the Content-Security-Policy hashes are the same for every address: only the head text changes', async () => {
  const home = await inlineScriptHashes(INDEX);
  assert.equal(home.length, 2);
  for (const path of ['/games', '/games/oro', '/abuja', '/ogun', '/kaduna', '/nigeria', '/nowhere', '/signup']) {
    const page = withPathMeta(INDEX, path);
    assert.notEqual(page, INDEX, path);
    assert.deepEqual(await inlineScriptHashes(page), home, path);
    // The scripts themselves are byte for byte the same.
    assert.deepEqual([...page.matchAll(/<script\b[^>]*>[\s\S]*?<\/script>/g)].map((match) => match[0]), [...INDEX.matchAll(/<script\b[^>]*>[\s\S]*?<\/script>/g)].map((match) => match[0]), path);
  }
})

test('the sitemap is made from the registry: the games, every open city, every state with several open cities', () => {
  const body = siteFile('/sitemap.xml', 'https://play.example')?.body ?? '';
  const locs = [...body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  assert.equal(new Set(locs).size, locs.length, 'no address twice');
  assert.ok(locs.includes('https://play.example/'));
  assert.ok(locs.includes('https://play.example/games'));
  for (const game of GAME_SLUGS) assert.ok(locs.includes(`https://play.example/games/${game}`), game);
  for (const id of openCityIds()) assert.ok(locs.includes(`https://play.example/${id}`), id);
  for (const state of knownStateIds()) assert.equal(locs.includes(`https://play.example/${state}`), openCitiesOf(state).length > 1 || openCityIds().includes(state), state);
  assert.ok(locs.includes('https://play.example/kaduna'), 'a capital that opened is listed');
  assert.deepEqual(locs.slice(1), sitemapPaths().map((path) => `https://play.example${path}`));
  assert.ok(body.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  assert.ok((siteFile('/sitemap.xml', '')?.body ?? '').includes(`<loc>${SITE_ORIGIN}/games</loc>`), 'with no origin: the site\'s own');
})

test('the Node host: the page for /games, /abuja and an unknown path, with the same policy hashes', async (t) => {
  const dist = await mkdtemp(join(tmpdir(), 'joinallworld-dist-'));
  t.after(() => rm(dist, { recursive: true, force: true }));
  await writeFile(join(dist, 'index.html'), INDEX);
  const f = await fixture(t, { distDir: dist, publicOrigin: 'https://play.example', log: () => {} });
  const home = await fetch(`${f.base}/`);
  const homeBody = await home.text();
  const homePolicy = home.headers.get('content-security-policy');
  assert.equal(title(homeBody), title(INDEX), 'the home page is untouched');
  assert.equal(canonical(homeBody), 'https://play.example/');
  for (const [path, expected] of [['/games', 'Play chess, the daily word and more — Allworld'], ['/games/oro', 'Oro, a new word every day — Allworld'], ['/abuja', 'Live in Abuja — Allworld'], ['/kano/', 'Live in Kano — Allworld']] as const) {
    const response = await fetch(`${f.base}${path}`);
    const body = await response.text();
    assert.equal(response.status, 200, path);
    assert.equal(title(body), expected, path);
    assert.equal(response.headers.get('content-security-policy'), homePolicy, `${path}: the policy is the home page's`);
    assert.equal(response.headers.get('cache-control'), 'no-cache');
    assert.match(canonical(body) ?? '', /^https:\/\/play\.example\/[a-z/]+$/);
    assert.equal(tag(body, 'og:image'), 'https://play.example/og/allworld.png');
  }
  const head = await fetch(`${f.base}/abuja`, { method: 'HEAD' });
  assert.equal(head.headers.get('content-security-policy'), homePolicy, 'HEAD gets the same policy');
  await head.arrayBuffer();
  const unknown = await fetch(`${f.base}/some/deep/link`);
  const body = await unknown.text();
  assert.deepEqual([unknown.status, tag(body, 'robots'), title(body)], [200, 'noindex,follow', title(INDEX)]);
  const sitemap = await fetch(`${f.base}/sitemap.xml`);
  assert.ok((await sitemap.text()).includes('<loc>https://play.example/abuja</loc>'));
})
