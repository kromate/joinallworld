// OWNER: growth — the public guides: /features, /pages and /skills on the Node host, plain HTML, no script, a contents list that links to every section.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixture } from './test-fixture.ts';
import { aboutPageHtml, featuresPageHtml, guidePage, pagesPageHtml, skillsPageHtml, PAGE_SECTIONS } from './docs-pages.ts';
import { aboutSections } from './docs-about.ts';
import { HOUSE_SKILL_FILES, SKILL_SECTIONS } from './docs-skills.ts';
import { FEATURE_SECTIONS } from './docs-features.ts';
import { parsePath, isReservedPath } from '../src/paths.ts';
import { sitemapPaths } from './path-meta.ts';

for (const [path, title] of [['/about', 'About — Allworld'], ['/features', 'Features — Allworld'], ['/pages', 'Pages — Allworld'], ['/skills', 'Skills — Allworld']] as const) {
  test(`guide ${path}: served as plain HTML with no script, its contents list, its canonical and the links between the guides`, async (t) => {
    const f = await fixture(t, { env: {} });
    const res = await f.request(path);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /text\/html/);
    const html = await res.text();
    for (const words of [`<title>${title}</title>`, `rel="canonical" href="${f.base}${path}"`, 'On this page', `href="${f.base}/about"`, `href="${f.base}/features"`, `href="${f.base}/pages"`, `href="${f.base}/skills"`, `href="${f.base}/money"`, `href="${f.base}/privacy"`, 'aria-current="page"']) assert.ok(html.includes(words), words);
    assert.equal(/<script/i.test(html), false, 'no script on the page');
    assert.equal((await f.request(`${path}/`)).status, 200, 'a trailing slash is the same page');
  });
}

test('guides: every section has a unique anchor the contents list links to, and every entry says what it does', () => {
  for (const [sections, html] of [[FEATURE_SECTIONS, featuresPageHtml('https://joinallworld.com')], [PAGE_SECTIONS, pagesPageHtml('https://joinallworld.com')], [SKILL_SECTIONS, skillsPageHtml('https://joinallworld.com')], [aboutSections('284 open cities in 243 countries'), aboutPageHtml('https://joinallworld.com')]] as const) {
    const ids = sections.map((s) => s.id);
    assert.equal(new Set(ids).size, ids.length, 'unique section ids');
    for (const id of ids) { assert.ok(html.includes(`<section id="${id}">`), id); assert.ok(html.includes(`href="#${id}"`), id) }
    for (const section of sections) {
      assert.ok(section.entries.length > 0 || (section.prose?.length ?? 0) > 0, section.id);
      for (const entry of section.entries) {
        assert.ok(entry.name.trim() && entry.text.trim(), `${section.id}: ${entry.name}`);
        if (entry.href) assert.match(entry.href, /^(\/[A-Za-z0-9/._-]*|https:\/\/github\.com\/kromate\/joinallworld\/[A-Za-z0-9/._-]+)$/, entry.href);
      }
    }
  }
});

test('guides: a linked name points at an address the game or the server answers, never at a share pattern', () => {
  for (const section of [...FEATURE_SECTIONS, ...PAGE_SECTIONS, ...SKILL_SECTIONS, ...aboutSections('')]) {
    for (const { href } of section.entries) if (href) assert.equal(href.includes('<'), false, href);
  }
  for (const path of ['/about', '/features', '/pages', '/skills']) assert.ok(isReservedPath(path), `${path} is never read as a place`);
  assert.equal(parsePath('/pages'), null);
  for (const path of ['/about', '/features', '/pages', '/skills']) assert.ok(sitemapPaths().includes(path), path);
  for (const path of ['/skills/allworld-house/SKILL.md', '/skills/x', '/pagesx', '/features/more', '/aboutx', '/about/team']) assert.equal(guidePage(path, ''), null, path);
});

test('guides: text is escaped and backquotes become code', () => {
  const html = pagesPageHtml('https://joinallworld.com');
  assert.ok(html.includes('<code>/&lt;city&gt;</code>'));
  assert.equal(featuresPageHtml('javascript:alert(1)').includes('javascript:'), false, 'an unsafe origin is dropped');
});

test('skills: every file of the served house skill is linked, and each link names a file the game ships', async () => {
  const index = JSON.parse(await readFile(new URL('../public/skills/allworld-house/index.json', import.meta.url), 'utf8')) as { files: string[] };
  assert.deepEqual(HOUSE_SKILL_FILES.map((f) => f.file).sort(), [...index.files].sort());
  const html = skillsPageHtml('https://joinallworld.com');
  for (const file of index.files) assert.ok(html.includes(`href="https://joinallworld.com/skills/allworld-house/${file}"`), file);
  for (const section of SKILL_SECTIONS) for (const { href } of section.entries) {
    const local = href?.match(/^https:\/\/github\.com\/kromate\/joinallworld\/(?:tree|blob)\/main\/(.+)$/)?.[1];
    if (local) await readFile(new URL(`../${local}${local.endsWith('/') || !local.includes('.') ? '/SKILL.md' : ''}`, import.meta.url));
  }
});

test('skills: the page is /skills itself, and a skill file under it is still served as a file', async (t) => {
  const dist = await mkdtemp(join(tmpdir(), 'allworld-skills-'));
  t.after(() => rm(dist, { recursive: true, force: true }));
  await writeFile(join(dist, 'index.html'), '<!doctype html><div id="app">game</div>');
  await mkdir(join(dist, 'skills', 'allworld-house'), { recursive: true });
  await writeFile(join(dist, 'skills', 'allworld-house', 'SKILL.md'), '# the house skill');
  const f = await fixture(t, { distDir: dist });
  const page = await f.request('/skills');
  assert.match(await page.text(), /<title>Skills — Allworld<\/title>/);
  const file = await f.request('/skills/allworld-house/SKILL.md');
  assert.equal(file.status, 200);
  assert.equal(await file.text(), '# the house skill');
});

test('about: what it is, why it was built and the vision, as prose with the live city count, and ways to join in', () => {
  const html = aboutPageHtml('https://joinallworld.com');
  for (const words of ['<h1>About Allworld</h1>', 'id="what"', 'id="why"', 'id="vision"', 'id="today"', 'id="join"', '<div class="prose">', '<strong>The real world first.</strong>', 'the OASIS in Ready Player One', 'open cities in', 'href="https://joinallworld.com/feedback"']) assert.ok(html.includes(words), words);
  assert.equal(html.includes('**'), false, 'bold markers are turned into strong');
});
