#!/usr/bin/env node
/**
 * Feature journey 2: city, state and country rankings (Rich List > Places). One player in a real browser; the other residents are
 * guests made through the real routes (session, life, civic pulse) on a local loopback server (scripts/journeys/lab.ts), so a ranked
 * place can be seen with real numbers. No outside request. The lab clock moves 11 s where the board's own 10-second reuse must pass.
 *
 *   node --experimental-strip-types --no-warnings scripts/journeys/places.ts --out <folder> [--port 4391] [--debug-port 4392]
 */
import { Browser, sleep } from './cdp.ts';
import { startLab } from './lab.ts';
import { Journey, actionId, arg, desktop, dismiss, gameShown, layoutProbe, must, pageCall, phone, playNow, realErrors, sessionId, syncClock, text, visible } from './kit.ts';

const port = Number(arg('port', '4391')), debugPort = Number(arg('debug-port', '4392'));
const lab = await startLab(port);
const A = await Browser.launch(debugPort);
const j = new Journey(arg('out'), 'places');
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.once(sig, () => { try { A.child.kill('SIGKILL'); } catch { /* gone */ } process.exit(130); });
const skip = async (ms: number): Promise<void> => { lab.advance(ms); await syncClock(A, lab.offset()); };
const guests: { name: string; cookie: string; id: string }[] = [];

async function openPlaces(): Promise<void> {
  const free = `(() => { const el = document.querySelector('[data-nav="phone"]'); if (!el) return false; const r = el.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!top && (el === top || el.contains(top)); })()`;
  for (let i = 0; i < 4 && !(await visible(A, '.places-segments')); i++) {
    if (!(await visible(A, '.ph-appbtn')) && !(await visible(A, 'button', 'Places'))) {
      for (let k = 0; k < 5 && !(await A.eval<boolean>(free)); k++) { await A.press('Escape', 'Escape', 27); await sleep(600); }
      await A.click('[data-nav="phone"]');
    }
    if (await visible(A, '.ph-appbtn', 'Rich List')) await A.click('.ph-appbtn', 'Rich List');
    await A.waitFor(`[...document.querySelectorAll('button')].some((b) => b.innerText.trim() === 'Places')`, 6000, 'the Places tab').catch(() => undefined);
    if (await visible(A, 'button', 'Places')) await A.click('button', 'Places');
    await A.waitFor(`!!document.querySelector('.places-segments')`, 6000, 'places').catch(() => undefined);
  }
  await A.waitFor(`!!document.querySelector('.places-segments') && !document.querySelector('.places')?.innerText.includes('Loading')`, 20000, 'the Places board');
  await sleep(700);
}
async function pick(scope: string, by?: string): Promise<void> {
  await A.click('.places-segments button', scope);
  if (by) await A.eval(`(() => { const s = document.querySelector('.places-by select'); const o = [...s.options].find((x) => x.text.startsWith(${JSON.stringify(by)})); s.value = o.value; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await sleep(1200);
  await A.waitFor(`!document.querySelector('.places')?.innerText.includes('Loading')`, 15000, 'the board to load');
}
const board = (): Promise<{ standing: string; rows: string[]; held: string; empty: string; share: string; buttons: string[]; caption: string; hero: string }> => A.eval(`(() => {
  const q = (s) => document.querySelector(s); const t = (s) => (q(s)?.innerText || '').replace(/\\s+/g, ' ').trim();
  return { standing: t('.places-you'), rows: [...document.querySelectorAll('.places-table tbody tr')].map((r) => r.innerText.replace(/\\s+/g, ' ').trim()), held: t('.places-held'), empty: q('.places-table') ? '' : t('.places .empty, .places [class*="empty"]'), share: t('[data-places="share"]'), buttons: [...document.querySelectorAll('.places-actions button')].map((b) => b.innerText.trim()), caption: t('.places-caption'), hero: t('.places-hero') };
})()`);

try {
  await desktop(A);
  await j.run('0', 'Setup: one new player (Play now), opens Rich List > Places', [A], async (detail) => {
    await playNow(A, lab.base, 'Ada Places');
    await openPlaces();
    detail['board'] = await board();
  });

  await j.run('1', 'Few players: every scope and every "Rank by": what is shown, is it a confusing empty table?', [A], async (detail) => {
    const out: Record<string, unknown> = {};
    for (const scope of ['Cities', 'States', 'Countries']) {
      await pick(scope, 'Pride');
      out[scope] = await board();
      await j.shot(A, `few-${scope.toLowerCase()}`);
    }
    for (const by of ['Pride', 'Total earned', 'Active', 'Players']) { await pick('Cities', by); out[`Cities by ${by}`] = await board(); }
    await pick('Cities', 'Pride'); await j.shot(A, 'few-cities-bottom').catch(() => undefined);
    await A.eval(`document.querySelector('.places-actions')?.scrollIntoView({ block: 'end' }); true`); await j.shot(A, 'few-bottom');
    detail['boards'] = out;
    const c = out['Cities'] as any;
    must(c.rows.length === 0, 'a place is ranked with one player');
    must(/not shown yet|needs 5|5 players/i.test(c.held + ' ' + c.standing), `no clear "not shown yet" note: held="${c.held}" standing="${c.standing}"`);
    must(!c.share && !c.buttons.some((b: string) => /Share|Copy/.test(b)), 'a share line is offered for an unranked place');
  });

  // five residents of Lagos: Ada + four guests; two of them also work a shift so the figures differ
  await j.run('2', 'Five active residents of one city (the browser player is a guest and is not counted by design): one ranked place with real numbers (made through the real routes)', [A], async (detail) => {
    for (const name of ['Chidi', 'Dayo', 'Efe', 'Funmi', 'Gbenga']) {
      const s = await lab.call('/api/session', { name });
      const cookie = s['setCookie'] as string;
      await lab.call('/api/life?city=lagos', undefined, cookie);
      guests.push({ name, cookie, id: s['session']?.id });
    }
    // two shifts of paid work (the game's own jobs) so "earned" differs between players
    for (const g of [guests[0]!, guests[1]!]) {
      const send = (action: object) => lab.call('/api/action', { actionId: actionId(), cityId: 'lagos', ...action }, g.cookie);
      await send({ type: 'apply-job', id: 'teaching' }); await send({ type: 'spot', id: 'work' }); const st = await send({ type: 'activity', id: 'teaching-shift' });
      detail[`${g.name}Shift`] = st['code'];
      await skip(41000);
      await lab.call('/api/life?city=lagos', undefined, g.cookie);
    }
    for (const g of guests) detail[`${g.name}Pulse`] = (await lab.call('/api/civic/pulse?city=lagos', undefined, g.cookie))['checkedIn'];
    const mine = await pageCall(A, '/api/civic/pulse?city=lagos');
    detail['adaPulse'] = { status: mine.status, checkedIn: mine.body?.checkedIn, counters: mine.body?.counters };
    await skip(11000);
    await A.goto(lab.base + '/'); await gameShown(A); await dismiss(A);
    await openPlaces();
    await pick('Cities', 'Pride');
    const b = await board();
    detail['board'] = b;
    { const api = await lab.call('/api/civic/boards?scope=city'); detail['apiRows'] = api['rows']; detail['apiUnranked'] = api['unranked']; }
    await j.shot(A, 'ranked-city-pride');
    must(b.rows.length === 1, `expected one ranked place, saw ${b.rows.length}: ${JSON.stringify(b)}`);
    must(/Your city/.test(b.rows[0]!), 'the player\'s own city is not marked "Your city"');
    must(/1st|#1/.test(b.standing + b.share), `no standing/share line: "${b.standing}" / "${b.share}"`);
  });

  await j.run('3', 'Ranked: Cities / States / Countries and each Rank by; own place highlighted; the standing and share lines', [A], async (detail) => {
    const out: Record<string, unknown> = {};
    for (const scope of ['Cities', 'States', 'Countries']) {
      for (const by of ['Pride', 'Total earned', 'Active', 'Players']) { await pick(scope, by); const b = await board(); out[`${scope}/${by}`] = { standing: b.standing, rows: b.rows, held: b.held, caption: b.caption }; if (by === 'Total earned') await j.shot(A, `ranked-${scope.toLowerCase()}-earned`); }
    }
    detail['boards'] = out;
    const highlighted = await A.eval<boolean>(`!!document.querySelector('.places-table tr.is-you[aria-current="true"]')`);
    detail['highlighted'] = highlighted;
    must(highlighted, 'the own-place row is not highlighted / aria-current');
    for (const key of Object.keys(out)) must((out[key] as any).rows.length === 1, `${key}: expected one row`);
    const hidden = JSON.stringify(out); for (const n of ['Ada Places', 'Chidi', 'Dayo', 'Efe', 'Funmi', 'Gbenga']) must(!hidden.includes(n), `${n} is named on a place board`);
  });

  await j.run('4', 'Share/copy line: the button, the toast, the line', [A], async (detail) => {
    await pick('Cities', 'Pride');
    const before = await board();
    detail['buttons'] = before.buttons; detail['line'] = before.share;
    await A.eval(`window.__toasts = []; new MutationObserver(() => { for (const t of document.querySelectorAll('.toast')) { const x = t.innerText.replace(/\\s+/g, ' ').trim(); if (x && !window.__toasts.includes(x)) window.__toasts.push(x); } }).observe(document.body, { childList: true, subtree: true, characterData: true }); true`);
    await A.click('.places-actions button', before.buttons.find((b) => /Share|Copy/.test(b)) ?? 'Copy');
    await sleep(1500);
    detail['toasts'] = await A.eval<string[]>(`window.__toasts`);
    await j.shot(A, 'share');
    must(before.share && !/https?:/.test(before.share), 'no plain-text share line');
    detail['note'] = 'This browser offers the native share sheet (button "Share where you stand"), which a headless run cannot answer; the copy-to-clipboard fallback was not exercised.';
    must(before.buttons.some((b) => /Share|Copy/.test(b)), 'no share/copy button');
  });

  // "Show more places" needs more than 25 ranked places (one page); every resident has to live in the city: pulse for another city answers city_moved.
  {
    const probe = await lab.call('/api/civic/pulse?city=ibadan', undefined, guests[0]!.cookie);
    j.skip('5', '"Show more places" (needs more than 25 ranked places, i.e. 130+ residents in 26+ cities)', `a resident cannot check in to a city the character is not in (${probe['error']}); the 25-row page cannot be exceeded locally. Covered by server/civic/boards.test.ts only.`);
  }

  await j.run('6', 'Simulated phone 390x844 and 320x568: board, table, buttons', [A], async (detail) => {
    const res: Record<string, unknown> = {};
    for (const [w, h] of [[390, 844], [320, 568]] as [number, number][]) {
      await phone(A, w, h); await sleep(900);
      const out: Record<string, unknown> = {};
      await pick('Cities', 'Pride');
      await A.eval(`document.querySelector('.places')?.scrollIntoView(); document.querySelector('.places-hero')?.scrollIntoView(); true`); await j.shot(A, `phone${w}-top`);
      out['top'] = await layoutProbe(A, '.places');
      await A.eval(`document.querySelector('.places-table')?.scrollIntoView({ block: 'center' }); true`); await j.shot(A, `phone${w}-table`);
      out['table'] = await A.eval<unknown>(`(() => { const t = document.querySelector('.places-table'), r = t.getBoundingClientRect(); return { right: Math.round(r.right), vw: innerWidth, overflow: t.scrollWidth > t.clientWidth + 1 || r.right > innerWidth + 1, firstRow: t.querySelector('tbody tr')?.innerText.replace(/\\s+/g, ' ') }; })()`);
      await A.eval(`document.querySelector('.places-actions')?.scrollIntoView({ block: 'center' }); true`); await j.shot(A, `phone${w}-actions`);
      out['actions'] = await layoutProbe(A, '.places-actions');
      out['byReachable'] = await A.eval<boolean>(`(() => { const s = document.querySelector('.places-by select'); s.scrollIntoView({ block: 'center' }); const r = s.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return top === s || s.contains(top); })()`);
      await pick('Countries', 'Total earned'); await A.eval(`document.querySelector('.places')?.scrollIntoView(); true`); await j.shot(A, `phone${w}-countries`);
      res[`${w}x${h}`] = out;
    }
    detail['sizes'] = res;
    await desktop(A);
  });
} catch (e) { console.log('ERR', e); }
finally {
  const code = j.finish({}, { player: realErrors(A) });
  try { A.close(); } catch { /* closed */ }
  await lab.stop(); process.exit(code);
}

async function cookieOf(): Promise<string> {
  const jar = await A.send('Network.getCookies', { urls: [lab.base] });
  return (jar.cookies as { name: string; value: string }[]).map((c) => `${c.name}=${c.value}`).join('; ');
}
