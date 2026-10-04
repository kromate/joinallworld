// The phone's DOM-free pieces: the icon set, the wallpaper preference and the report-reply badge.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: (key: string) => (data.has(key) ? data.get(key) : null), setItem: (key: string, value: unknown) => data.set(key, String(value)), data };
}

test('every Phone app has its own drawn icon and colour, and an unknown id still draws something', async () => {
  const { glyph, glyphFor, hasGlyph } = await import('./icons.ts');
  assert.equal(hasGlyph('contacts'), false, 'app-only glyphs are not in the first download');
  assert.match(glyph('contacts'), /^<svg aria-hidden="true"/, 'a glyph that has not arrived yet still draws a placeholder');
  const { appIcon, TINTS, tintOf } = await import('./icons-more.ts'); // adds the rest of the set
  const apps = ['jobs', 'messages', 'bank', 'ride', 'statement', 'invest', 'career', 'richlist', 'goals', 'health', 'groceries', 'boutique', 'houses', 'cars', 'settings', 'help',
    'contacts', 'people', 'family', 'invite', 'community', 'governor', 'neighbours', 'ads', 'hunt-sheet', 'radio', 'support'];
  const drawn = new Set();
  for (const id of apps) {
    assert.ok(hasGlyph(glyphFor(id)) && glyphFor(id) !== 'info', `${id} has a glyph`);
    assert.match(TINTS[id]!, /^#[0-9a-f]{6}$/, `${id} has a colour`);
    drawn.add(glyph(glyphFor(id)));
    assert.match(appIcon(id), /^<span class="ph-icon" style="--tint:#[0-9a-f]{6}"><svg aria-hidden="true"/);
  }
  assert.equal(drawn.size, apps.length, 'no two apps share a drawing');
  assert.equal(glyphFor('no-such-app'), 'info');
  assert.equal(tintOf({ id: 'bank', tint: '#123456' }), '#123456');
  assert.equal(tintOf({ id: 'bank' }), TINTS.bank);
  // Inline SVG only: no image files, no fonts, nothing fetched.
  for (const file of ['./icons.ts', './icons-more.ts']) assert.doesNotMatch(await readFile(new URL(file, import.meta.url), 'utf8'), /url\(|<image|href=|@font-face/);
});

test('the wallpaper is a preference of this device: unknown values fall back, a refused save still applies', async (t) => {
  const real = globalThis.localStorage;
  t.after(() => { Object.defineProperty(globalThis, 'localStorage', { value: real, configurable: true, writable: true }); });
  const store = fakeStorage({ 'joinallworld-wallpaper': 'not-a-wallpaper' });
  Object.defineProperty(globalThis, 'localStorage', { value: store, configurable: true, writable: true });
  const { WALLPAPERS, WALLPAPER_KEY, getWallpaper, setWallpaper } = await import('./wallpapers.ts');
  assert.ok(WALLPAPERS.length >= 3 && WALLPAPERS.length <= 4);
  assert.equal(getWallpaper(), WALLPAPERS[0]!.id);
  assert.equal(setWallpaper('nonsense'), false); assert.equal(getWallpaper(), WALLPAPERS[0]!.id);
  assert.equal(setWallpaper(WALLPAPERS[2]!.id), true);
  assert.equal(getWallpaper(), WALLPAPERS[2]!.id); assert.equal(store.data.get(WALLPAPER_KEY), WALLPAPERS[2]!.id);
  Object.defineProperty(globalThis, 'localStorage', { value: { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } }, configurable: true, writable: true });
  assert.equal(setWallpaper(WALLPAPERS[1]!.id), false, 'the browser would not save it');
  assert.equal(getWallpaper(), WALLPAPERS[1]!.id, 'it still applies for this visit');
  // Every wallpaper is CSS: each id has a rule and none of them loads a picture.
  const css = await readFile(new URL('./phone.css', import.meta.url), 'utf8');
  for (const item of WALLPAPERS) assert.ok(css.includes(`[data-wall=${item.id}] .ph-wallpaper`), `${item.id} is drawn in CSS`);
  assert.doesNotMatch(css, /url\(/);
});

test('the Report badge counts replies not read on this device, and reading clears it', async (t) => {
  const real = globalThis.localStorage;
  t.after(() => { Object.defineProperty(globalThis, 'localStorage', { value: real, configurable: true, writable: true }); });
  Object.defineProperty(globalThis, 'localStorage', { value: fakeStorage(), configurable: true, writable: true });
  const { noteReports, reportReplies, markReportsRead } = await import('./reports.ts');
  assert.equal(reportReplies(), 0, 'nothing loaded yet: no badge');
  noteReports([{ id: 'P-1', at: 100, updatedAt: 100, note: '', status: 'received' }, { id: 'P-2', at: 100, updatedAt: 250, note: 'Refunded.', status: 'resolved' }]);
  assert.equal(reportReplies(), 1, 'only the report a moderator answered');
  assert.equal(markReportsRead(), true); assert.equal(reportReplies(), 0);
  noteReports([{ id: 'P-1', at: 100, updatedAt: 300, note: '', status: 'reviewing' }, { id: 'P-2', at: 100, updatedAt: 250, note: 'Refunded.', status: 'resolved' }]);
  assert.equal(reportReplies(), 1, 'a new status on an old report counts again');
  assert.equal(markReportsRead(), true); assert.equal(markReportsRead(), false);
});

test('the phone runs nothing while idle: no timers and no frame loop in its sources', async () => {
  for (const file of ['phone.ts', 'icons.ts', 'wallpapers.ts', 'reports.ts', 'how.ts', 'logic.ts']) {
    const code = (await readFile(new URL(`./${file}`, import.meta.url), 'utf8')).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    assert.doesNotMatch(code, /requestAnimationFrame|setAnimationLoop|setInterval|setTimeout/, file);
  }
});

test('the Governor badge counts only city news that is new to this life and not yet read', async () => {
  const { unseenNews } = await import('./logic.ts');
  const notices = [{ id: 'a', at: 1000 }, { id: 'b', at: 2000 }, { id: 'c', at: 3000 }];
  assert.equal(unseenNews(notices, { readAt: 0, since: 5000 }), 0, 'a brand-new life: everything in the city is older than it');
  assert.equal(unseenNews(notices, { readAt: 0, since: 1500 }), 2, 'only what happened after the life began');
  assert.equal(unseenNews(notices, { readAt: 0, since: 2000 }), 2, 'news at the very moment the life began counts, as it does for Updates');
  assert.equal(unseenNews(notices, { readAt: 2000, since: 0 }), 1, 'what the Governor app already showed is read');
  assert.equal(unseenNews(notices, { readAt: 9000, since: 0 }), 0);
  assert.equal(unseenNews(notices, { readAt: 2500, since: 2800 }), 1, 'a read marker left by an earlier life on this device cannot bring old news back');
  assert.equal(unseenNews(notices, { readAt: 0 }), 0, 'no life yet: no guess');
  assert.equal(unseenNews(notices, { readAt: 0, since: NaN }), 0);
  assert.equal(unseenNews(null, { since: 0 }), 0);
  assert.equal(unseenNews([{ at: 'soon' }, null, { at: 10 }], { since: 0 }), 1, 'malformed notices are ignored');
});

test('opening the phone asks for the reports once, then only while an answer can still arrive', async () => {
  const { shouldCheckReports, unreadReports, reportOpen } = await import('./logic.ts');
  const base = { connected: true, checking: false, now: 1_000_000 };
  assert.equal(shouldCheckReports({ ...base }), true, 'first opening on this page: one look, app never opened');
  assert.equal(shouldCheckReports({ ...base, connected: false }), false, 'never while not connected');
  assert.equal(shouldCheckReports({ ...base, checking: true }), false, 'never two at once');
  assert.equal(shouldCheckReports({ ...base, triedAt: base.now - 5000 }), false, 'a failed look is not repeated within the minute');
  assert.equal(shouldCheckReports({ ...base, triedAt: base.now - 61000 }), true, 'but it is tried again later');
  const done = { ...base, checkedAt: base.now - 120000, triedAt: base.now - 120000 };
  assert.equal(shouldCheckReports({ ...done, known: [] }), false, 'nothing reported: no more requests on this page');
  assert.equal(shouldCheckReports({ ...done, known: [{ id: 'P-1', status: 'resolved' }, { id: 'P-2', status: 'dismissed' }] }), false, 'everything is closed');
  assert.equal(shouldCheckReports({ ...done, known: [{ id: 'P-1', status: 'received' }] }), true, 'an open report may be answered');
  assert.equal(shouldCheckReports({ ...done, checkedAt: base.now - 30000, known: [{ id: 'P-1', status: 'reviewing' }] }), false, 'at most once a minute');
  assert.equal(shouldCheckReports({ ...done, known: null, filed: true }), true);
  assert.equal(reportOpen({ status: 'reviewing' }), true); assert.equal(reportOpen({ status: 'resolved' }), false);
  const reports = [{ id: 'P-1', at: 100, updatedAt: 100, note: '' }, { id: 'P-2', at: 100, updatedAt: 250, note: 'Refunded.' }, { id: 'P-3', at: 100, updatedAt: 300, note: '' }];
  assert.equal(unreadReports(reports, {}), 2, 'a note or a status change is an answer');
  assert.equal(unreadReports(reports, { 'P-2': 250 }), 1);
  assert.equal(unreadReports(reports, { 'P-2': 250, 'P-3': 300 }), 0);
  assert.equal(unreadReports(undefined), 0);
});

test('reportAnswered compares as the original did: a null time is 0, an absent one never compares', async () => {
  const { reportAnswered } = await import('./logic.ts');
  assert.equal(reportAnswered({ at: null, updatedAt: 5 }), true, 'null coerces to 0, so a numeric update answers it');
  assert.equal(reportAnswered({ at: 0, updatedAt: 5 }), true);
  assert.equal(reportAnswered({ at: 5, updatedAt: 5 }), false);
  assert.equal(reportAnswered({ at: null, updatedAt: null }), false);
  assert.equal(reportAnswered({ updatedAt: 5 }), false, 'an absent `at` is NaN, as before');
  assert.equal(reportAnswered({ at: 5 }), false);
  assert.equal(reportAnswered({ updatedAt: 5, note: 'Done.' }), true, 'a note always answers');
  assert.equal(reportAnswered(null), false);
});

test('checkReports fetches once when the phone opens, without the app, and shows the badge', async (t) => {
  const real = globalThis.localStorage;
  t.after(() => { Object.defineProperty(globalThis, 'localStorage', { value: real, configurable: true, writable: true }); });
  Object.defineProperty(globalThis, 'localStorage', { value: fakeStorage(), configurable: true, writable: true });
  const specifier = './reports.ts?badge'; // a variable, so the type checker does not look for a file of that name
  const { checkReports, reportReplies, markReportsRead } = (await import(specifier)) as typeof import('./reports.ts'); // a fresh copy of the module's state
  let fetches = 0, refreshes = 0, connected = false;
  const api = { view: () => ({ connected }), refresh: () => { refreshes += 1; },
    fetchJson: async (path: string) => { fetches += 1; assert.equal(path, '/api/support/reports'); return { reports: [{ id: 'P-9', at: 100, updatedAt: 400, note: 'Fixed.', status: 'resolved' }] }; } };
  assert.equal(checkReports(api, 1000), false, 'not connected: nothing is sent');
  connected = true;
  assert.equal(checkReports(api, 1000), true);
  assert.equal(checkReports(api, 1001), false, 'one request at a time');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fetches, 1); assert.equal(reportReplies(), 1, 'the reply is a badge although the app was never opened'); assert.equal(refreshes, 1);
  assert.equal(checkReports(api, Date.now() + 600000), false, 'every report is closed: opening the phone again asks nothing');
  assert.equal(markReportsRead(), true); assert.equal(reportReplies(), 0);
  assert.equal(fetches, 1);
});

test('How it works: the open state is kept by id, and an unchanged toggle changes nothing', async () => {
  const { toggled, rulesList } = await import('./logic.ts');
  const none = new Set<string>();
  const one = toggled(none, 'bank-rent', true);
  assert.deepEqual([...one], ['bank-rent']); assert.equal(none.size, 0, 'the old set is not touched');
  assert.equal(toggled(one, 'bank-rent', true), one, 'markup that arrives open raises a toggle too: same set, no redraw');
  assert.equal(toggled(one, 'bank-loan', false), one);
  assert.deepEqual([...toggled(toggled(one, 'bank-loan', true), 'bank-rent', false)], ['bank-loan']);
  assert.deepEqual(rulesList(['  A rule. ', '', null, 'Another.']), ['A rule.', 'Another.']);
  assert.deepEqual(rulesList('One.'), ['One.']);
});

test('Groceries “Buy 1 pack”: the price on the button is the server’s, and it says why it cannot be pressed', async () => {
  const { quickBuy } = await import('./logic.ts');
  assert.deepEqual(quickBuy({ quote: { price: 600, list: 600 }, cash: 5000, connected: true }), { price: 600, blocked: '' });
  assert.deepEqual(quickBuy({ quote: { price: 540, list: 600 }, cash: 540, connected: true }), { price: 540, blocked: '' }, 'a discount the server quoted is the price; exactly enough is enough');
  assert.equal(quickBuy({ quote: { price: 600 }, cash: 250, connected: true }).blocked, 'Need ₦350 more');
  assert.match(quickBuy({ quote: { price: 600 }, cash: 5000, connected: false }).blocked, /^Not connected/);
  assert.equal(quickBuy({ quote: { price: 600 }, cash: 0, connected: false }).price, 600, 'the price stays on a disabled button');
  assert.equal(quickBuy({ quote: { price: 600 }, cash: 5000, connected: true, busy: true }).blocked, 'Ordering…', 'one purchase at a time');
  assert.match(quickBuy({ quote: null, cash: 5000, connected: true, label: 'Eggs' }).blocked, /No price for Eggs/);
});

test('every “How it works” in an app keeps its state, and the Bank keeps costs and deadlines on the card', async () => {
  const dir = new URL('../../app/features/', import.meta.url);
  for (const file of ['bank/BankApp', 'civic/GovernorApp', 'jobs/JobsApp', 'money/InvestApp', 'money/StatementApp', 'home/HousesApp', 'home/CarsApp', 'home/GroceriesApp', 'travel/RideApp', 'civic/RichlistApp', 'civic/NeighboursApp', 'civic/AdsApp', 'civic/HuntSheet', 'civic/RadioApp', 'social/InviteApp', 'sim/SettingsTab', 'support/ReportApp']) {
    let code: string;
    try { code = await readFile(new URL(`${file}.vue`, dir), 'utf8'); } catch { continue; }
    assert.doesNotMatch(code, /<details class="ui-details">/, `${file} has no disclosure that forgets its state`);
  }
  const bank = await readFile(new URL('bank/BankApp.vue', dir), 'utf8') + await readFile(new URL('bank/bankModel.ts', dir), 'utf8');
  assert.match(bank, /HowItWorks/, 'the Bank folds its rules behind a disclosure');
  for (const shown of ['rent.nextDueLabel', 'rent.amount', 'rent.lateFee', 'loan.nextCollection', 'loan.instalment', 'penalty']) assert.ok(bank.includes(shown), `Bank shows ${shown}`);
});

