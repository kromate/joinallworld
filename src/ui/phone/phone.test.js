// The phone's DOM-free pieces: the icon set, the wallpaper preference and the report-reply badge.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

function fakeStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: (key) => (data.has(key) ? data.get(key) : null), setItem: (key, value) => data.set(key, String(value)), data };
}

test('every Phone app has its own drawn icon and colour, and an unknown id still draws something', async () => {
  const { appIcon, glyph, glyphFor, hasGlyph, TINTS, tintOf } = await import('./icons.js');
  const apps = ['jobs', 'messages', 'bank', 'ride', 'statement', 'invest', 'career', 'richlist', 'goals', 'health', 'groceries', 'boutique', 'houses', 'cars', 'settings', 'help',
    'contacts', 'people', 'family', 'invite', 'community', 'governor', 'neighbours', 'ads', 'hunt-sheet', 'radio', 'support'];
  const drawn = new Set();
  for (const id of apps) {
    assert.ok(hasGlyph(glyphFor(id)) && glyphFor(id) !== 'info', `${id} has a glyph`);
    assert.match(TINTS[id], /^#[0-9a-f]{6}$/, `${id} has a colour`);
    drawn.add(glyph(glyphFor(id)));
    assert.match(appIcon(id), /^<span class="ph-icon" style="--tint:#[0-9a-f]{6}"><svg aria-hidden="true"/);
  }
  assert.equal(drawn.size, apps.length, 'no two apps share a drawing');
  assert.equal(glyphFor('no-such-app'), 'info');
  assert.equal(tintOf({ id: 'bank', tint: '#123456' }), '#123456');
  assert.equal(tintOf({ id: 'bank' }), TINTS.bank);
  // Inline SVG only: no image files, no fonts, nothing fetched.
  assert.doesNotMatch(await readFile(new URL('./icons.js', import.meta.url), 'utf8'), /url\(|<image|href=|@font-face/);
});

test('the wallpaper is a preference of this device: unknown values fall back, a refused save still applies', async (t) => {
  const real = globalThis.localStorage;
  t.after(() => { Object.defineProperty(globalThis, 'localStorage', { value: real, configurable: true, writable: true }); });
  const store = fakeStorage({ 'joinallworld-wallpaper': 'not-a-wallpaper' });
  Object.defineProperty(globalThis, 'localStorage', { value: store, configurable: true, writable: true });
  const { WALLPAPERS, WALLPAPER_KEY, getWallpaper, setWallpaper } = await import('./wallpapers.js');
  assert.ok(WALLPAPERS.length >= 3 && WALLPAPERS.length <= 4);
  assert.equal(getWallpaper(), WALLPAPERS[0].id);
  assert.equal(setWallpaper('nonsense'), false); assert.equal(getWallpaper(), WALLPAPERS[0].id);
  assert.equal(setWallpaper(WALLPAPERS[2].id), true);
  assert.equal(getWallpaper(), WALLPAPERS[2].id); assert.equal(store.data.get(WALLPAPER_KEY), WALLPAPERS[2].id);
  Object.defineProperty(globalThis, 'localStorage', { value: { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } }, configurable: true, writable: true });
  assert.equal(setWallpaper(WALLPAPERS[1].id), false, 'the browser would not save it');
  assert.equal(getWallpaper(), WALLPAPERS[1].id, 'it still applies for this visit');
  // Every wallpaper is CSS: each id has a rule and none of them loads a picture.
  const css = await readFile(new URL('./phone.css', import.meta.url), 'utf8');
  for (const item of WALLPAPERS) assert.ok(css.includes(`[data-wall=${item.id}] .ph-wallpaper`), `${item.id} is drawn in CSS`);
  assert.doesNotMatch(css, /url\(/);
});

test('the Report badge counts replies not read on this device, and reading clears it', async (t) => {
  const real = globalThis.localStorage;
  t.after(() => { Object.defineProperty(globalThis, 'localStorage', { value: real, configurable: true, writable: true }); });
  Object.defineProperty(globalThis, 'localStorage', { value: fakeStorage(), configurable: true, writable: true });
  const { noteReports, reportReplies, markReportsRead } = await import('./reports.js');
  assert.equal(reportReplies(), 0, 'nothing loaded yet: no badge');
  noteReports([{ id: 'P-1', at: 100, updatedAt: 100, note: '', status: 'received' }, { id: 'P-2', at: 100, updatedAt: 250, note: 'Refunded.', status: 'resolved' }]);
  assert.equal(reportReplies(), 1, 'only the report a moderator answered');
  assert.equal(markReportsRead(), true); assert.equal(reportReplies(), 0);
  noteReports([{ id: 'P-1', at: 100, updatedAt: 300, note: '', status: 'reviewing' }, { id: 'P-2', at: 100, updatedAt: 250, note: 'Refunded.', status: 'resolved' }]);
  assert.equal(reportReplies(), 1, 'a new status on an old report counts again');
  assert.equal(markReportsRead(), true); assert.equal(markReportsRead(), false);
});

test('the phone runs nothing while idle: no timers and no frame loop in its sources', async () => {
  for (const file of ['phone.js', 'icons.js', 'wallpapers.js', 'reports.js']) {
    const code = (await readFile(new URL(`./${file}`, import.meta.url), 'utf8')).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    assert.doesNotMatch(code, /requestAnimationFrame|setAnimationLoop|setInterval|setTimeout/, file);
  }
});
