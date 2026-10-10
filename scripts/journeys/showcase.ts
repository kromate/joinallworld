#!/usr/bin/env node
/**
 * Feature journey 3: showcase shops (docs/SHOWCASE.md). A seller, an adult buyer and a guest, each in an isolated browser context of ONE
 * Chrome, against the built app on a local loopback server (scripts/journeys/lab.ts: fresh data, stand-in sign-in, an operator token
 * made up for the run, and a clock that is moved 25 h so a new account passes the 24-hour wait). No outside request is made.
 *
 *   node --experimental-strip-types --no-warnings scripts/journeys/showcase.ts --out <folder> [--port 4391] [--debug-port 4392]
 *
 * Operator work (the phone tier, the approval) is made with the documented routes; everything a seller or a buyer does is the real UI.
 * Test photos are made in the page (canvas to JPEG) and given to the real file input. Exit code is not zero when a step fails.
 */
import { writeFileSync } from 'node:fs';
import { crc32, deflateSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Browser, sleep } from './cdp.ts';
import { startLab } from './lab.ts';
import { Journey, arg, desktop, dismiss, gameShown, layoutProbe, must, pageCall, phone, playNow, realErrors, sessionId, syncClock, text, visible } from './kit.ts';

const port = Number(arg('port', '4391')), debugPort = Number(arg('debug-port', '4392'));
const lab = await startLab(port);
const S = await Browser.launch(debugPort);          // the seller
const B = await Browser.second(debugPort, S);       // the adult buyer
const G = await Browser.second(debugPort, S);       // the guest
const j = new Journey(arg('out'), 'showcase');
const HOUR = 3600000;
const CHAT = 'https://wa.me/2348012345678', PAY = 'https://paystack.com/pay/ada-braids-demo', PAY2 = 'https://paystack.com/pay/ada-braids-new';
const ids: Record<string, string> = {};
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.once(sig, () => { try { S.child.kill('SIGKILL'); } catch { /* gone */ } process.exit(130); });

async function openServices(p: Browser): Promise<void> {
  if (await visible(p, '.sc-app')) return;
  if (!(await visible(p, '.ph-appbtn'))) await p.click('[data-nav="phone"]');
  for (let i = 0; i < 3 && !(await visible(p, '.sc-app')); i++) {
    if (await visible(p, '.ph-appbtn', 'Services')) await p.click('.ph-appbtn', 'Services');
    await p.waitFor(`!!document.querySelector('.sc-app')`, 6000, 'the Services app').catch(() => undefined);
  }
  await p.waitFor(`!!document.querySelector('.sc-app')`, 8000, 'the Services app');
}
async function tab(p: Browser, name: string): Promise<void> { await p.click('.sc-tabs [role="tab"]', name); await sleep(400); }
/** Sets a form control by its label text inside the editor, the way typing would (real key input for text). */
async function fill(p: Browser, label: string, value: string, scope = '.se'): Promise<void> {
  const sel = await p.eval<string>(`(() => { const l = [...document.querySelectorAll(${JSON.stringify(scope)} + ' label')].find((x) => x.childNodes[0] && x.childNodes[0].textContent.trim().startsWith(${JSON.stringify(label)})); if (!l) return ''; const c = l.querySelector('input,textarea,select'); c.setAttribute('data-fill', '1'); return '[data-fill="1"]'; })()`);
  must(sel, `no field labelled "${label}"`);
  await p.type(sel, value);
  await p.eval(`document.querySelector('[data-fill]')?.removeAttribute('data-fill'); true`);
}
const note = (p: Browser): Promise<string> => p.eval<string>(`(document.querySelector('[data-note]') || {}).innerText || ''`);
const statusLine = (p: Browser): Promise<string> => p.eval<string>(`(document.querySelector('[data-status]') || {}).innerText || ''`);
async function clickText(p: Browser, selector: string, label: string): Promise<void> { await p.click(selector, label); }
async function saveShop(p: Browser): Promise<string> {
  const before = await note(p);
  await p.eval(`window.__noteSeen = ''; true`);
  await p.click('.se-form button.is-primary');
  await p.waitFor(`(() => { const n = (document.querySelector('[data-note]') || {}).innerText || ''; return n && n !== ${JSON.stringify(before)} || (n && n === ${JSON.stringify(before)} && false); })()`, 12000, 'a note after Save').catch(() => undefined);
  await sleep(600);
  return note(p);
}
/** A real photo made in the page: a gradient with shapes, as a JPEG file on disk (name given), by seed. */
async function makePhoto(p: Browser, file: string, seed: number): Promise<string> {
  const url = await p.eval<string>(`(() => { const seed = ${seed}; const c = document.createElement('canvas'); c.width = 900; c.height = 700; const x = c.getContext('2d'); const g = x.createLinearGradient(0, 0, 900, 700); g.addColorStop(0, 'hsl(' + (seed * 70 % 360) + ',70%,60%)'); g.addColorStop(1, 'hsl(' + ((seed * 70 + 120) % 360) + ',60%,35%)'); x.fillStyle = g; x.fillRect(0, 0, 900, 700); for (let i = 0; i < 18; i++) { x.fillStyle = 'hsla(' + ((seed * 40 + i * 25) % 360) + ',80%,70%,0.55)'; x.beginPath(); x.arc((i * 137 + seed * 53) % 900, (i * 91 + seed * 31) % 700, 40 + (i * 13) % 90, 0, 7); x.fill(); } x.fillStyle = '#fff'; x.font = 'bold 64px sans-serif'; x.fillText('Braids ' + seed, 60, 120); return c.toDataURL('image/jpeg', 0.82); })()`);
  const path = join(tmpdir(), file);
  writeFileSync(path, Buffer.from(url.split(',')[1]!, 'base64'));
  return path;
}
/** Gives files to the editor's real file input. */
async function giveFiles(p: Browser, files: string[]): Promise<void> {
  const doc = await p.send('DOM.getDocument', { depth: 1 });
  const found = await p.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '.se-file input[type=file]' });
  must(found.nodeId, 'no file input in the editor');
  await p.send('DOM.setFileInputFiles', { nodeId: found.nodeId, files });
}
const tmpFiles: string[] = [];
/** A real PNG of random pixels (so it cannot be shrunk below the cap), made without a library. */
function noisePng(w: number, h: number): Buffer {
  const chunk = (type: string, data: Buffer): Buffer => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body)); return Buffer.concat([len, body, crc]); };
  const head = Buffer.alloc(13); head.writeUInt32BE(w, 0); head.writeUInt32BE(h, 4); head[8] = 8; head[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h); let seed = 12345;
  for (let i = 0; i < raw.length; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; raw[i] = seed >>> 24; }
  for (let y = 0; y < h; y++) raw[y * (w * 3 + 1)] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', deflateSync(raw, { level: 0 })), chunk('IEND', Buffer.alloc(0))]);
}

try {
  await desktop(S); await desktop(B); await desktop(G);

  await j.run('0', 'Setup: seller and buyer sign in (stand-in provider), 25 h pass, operator sets the phone tier', [S, B], async (detail) => {
    await playNow(S, lab.base, 'Ada Braids'); await playNow(B, lab.base, 'Buyer Bola'); await playNow(G, lab.base, 'Guest Gbenga');
    ids['seller'] = await sessionId(S); ids['buyer'] = await sessionId(B); ids['guest'] = await sessionId(G);
    await lab.signIn(S, 'seller@example.test'); await lab.signIn(B, 'buyer@example.test');
    for (const p of [S, B]) { await p.goto(lab.base + '/'); await gameShown(p); await dismiss(p); }
    ids['seller'] = await sessionId(S); ids['buyer'] = await sessionId(B);
    lab.advance(25 * HOUR);
    for (const p of [S, B, G]) await syncClock(p, lab.offset());
    const tier = await lab.admin(`/api/admin/trust/players/${ids['seller']}/act`, { clientId: `${lab.now()}:${crypto.randomUUID()}`, action: 'verify', tier: 'phone', reason: 'journey: met in person' });
    detail['tier'] = { status: tier.status, ok: tier['ok'] };
    must(tier['ok'] === true, `the phone tier was not set: ${JSON.stringify(tier).slice(0, 200)}`);
  });

  await j.run('1', 'Seller: My shop shows the adult question first; blocked until answered', [S], async (detail) => {
    await openServices(S);
    await j.shot(S, 'browse-empty');
    detail['browseText'] = (await text(S, '.sc-app')).replace(/\s+/g, ' ').slice(0, 400);
    await tab(S, 'My shop');
    await S.waitFor(`document.querySelector('[data-showcase-editor]') && !document.querySelector('[data-showcase-editor]').innerText.includes('Loading')`, 15000, 'the editor');
    detail['blockedText'] = (await text(S, '.se-block')).replace(/\s+/g, ' ');
    await j.shot(S, 'my-shop-blocked');
    must(/18|adult/i.test(String(detail['blockedText'])), 'no adult question shown');
    await S.click('.se-block button', 'I am 18');
    await S.waitFor(`!document.querySelector('.se-block')`, 10000, 'the block to clear');
  });

  await j.run('2', 'Editor: template, colours and logo change the preview card', [S], async (detail) => {
    const sf = () => S.eval<{ bg: string; alt: string; text: string; layout: string }>(`(() => { const c = document.querySelector('.se [data-storefront]'); const s = getComputedStyle(c); return { bg: c.style.getPropertyValue('--sf-bg'), alt: c.style.getPropertyValue('--sf-alt'), text: c.innerText.replace(/\\s+/g, ' '), layout: c.className }; })()`);
    const first = await sf();
    await S.click('.se-choices label', 'Bold'); const bold = await sf(); await j.shot(S, 'template-bold');
    await S.click('.se-choices label', 'Night'); const night = await sf();
    await S.click('.se-choices label', 'Fresh'); const fresh = await sf(); await j.shot(S, 'template-fresh');
    await S.click('.se-choices label', 'Classic');
    await S.click('.se-choices[aria-label="Logo"] label[title="Scissors"]');
    detail['previews'] = { first, bold, night, fresh };
    detail['afterLogo'] = await sf();
    must(first.bg !== bold.bg && bold.bg !== night.bg && night.bg !== fresh.bg, 'the colours did not change with the template');
    must(first.layout !== bold.layout, 'the layout class did not change with the template');
    must(/✂/.test((await sf()).text), 'the chosen logo is not on the preview');
    await S.eval(`(() => { const i = document.querySelectorAll('.se-colours input[type=color]')[0]; i.value = '#aa3300'; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    detail['afterColour'] = await sf();
    must((await sf()).bg === '#aa3300', 'the sign colour did not change the preview');
  });

  await j.run('3', 'Editor: fill sign, about, services with prices, hours, chat and pay links; save', [S], async (detail) => {
    await fill(S, 'Shop name', 'Ada Braids');
    await fill(S, 'Sign (on the front', 'Braids by Ada');
    await fill(S, 'About', 'Neat knotless braids and natural hair care since 2019. Come to the market and ask for the Ada stall.');
    await fill(S, 'Service', 'Knotless braids', '.se-service');
    await fill(S, 'Your price', '25000', '.se-service');
    await fill(S, 'Note', 'About four hours', '.se-service');
    await S.click('button', 'Add a service');
    await S.eval(`(() => { const s = [...document.querySelectorAll('.se-service')].at(-1); s.setAttribute('id', 'svc2'); return true; })()`);
    await fill(S, 'Service', 'Wash and set', '#svc2'); await fill(S, 'Your price', '6000', '#svc2');
    await fill(S, 'Chat link', CHAT);
    await fill(S, 'Payment link', PAY);
    await j.shot(S, 'form-filled-top');
    detail['issuesBefore'] = await S.eval<string[]>(`[...document.querySelectorAll('.se-issues li')].map((x) => x.innerText)`);
    detail['noteAfterSave'] = await saveShop(S);
    await S.waitFor(`document.querySelector('[data-status]')`, 10000, 'the status banner after the first save');
    detail['status'] = await statusLine(S);
    await S.eval(`document.querySelector('.se-photos')?.scrollIntoView(); true`);
    await j.shot(S, 'after-save');
    must(/Saved/.test(String(detail['noteAfterSave'])), `no confirmation after Save: ${detail['noteAfterSave']}`);
  });

  await j.run('4', 'Refusals a seller meets: phone number, web link in the text; bad pay host; fewer than 3 photos; unusable photos', [S], async (detail) => {
    const out: Record<string, unknown> = {};
    const about = await S.eval<string>(`document.querySelector('.se textarea').value`);
    await fill(S, 'About', 'Call me on 0801 234 5678 for braids at the market.');
    out['phoneInAbout'] = await saveShop(S); await j.shot(S, 'refuse-phone');
    await fill(S, 'About', 'See my work at www.adabraids.com and book there.');
    out['linkInAbout'] = await saveShop(S); await j.shot(S, 'refuse-link');
    await fill(S, 'About', about);
    await fill(S, 'Payment link', 'https://evil-pay.example.com/ada');
    out['badPayHost'] = await saveShop(S); await j.shot(S, 'refuse-pay-host');
    await fill(S, 'Payment link', PAY);
    out['saveGood'] = await saveShop(S);
    // fewer than 3 photos: two good photos, then ask to send
    const p1 = await makePhoto(S, 'shop-1.jpg', 1), p2 = await makePhoto(S, 'shop-2.jpg', 2); tmpFiles.push(p1, p2);
    await giveFiles(S, [p1]); await S.waitFor(`document.querySelectorAll('.se-thumbs li').length >= 1`, 20000, 'photo 1'); 
    await giveFiles(S, [p2]); await S.waitFor(`document.querySelectorAll('.se-thumbs li').length >= 2`, 20000, 'photo 2');
    out['sendButtonWith2'] = await visible(S, '.se-actions button', 'Send for review');
    out['statusWith2'] = await statusLine(S);
    const direct = await pageCall(S, '/api/showcase/mine/submit', { clientId: `${lab.now()}:${crypto.randomUUID()}` });
    out['directSubmitWith2'] = { status: direct.status, body: direct.body };
    await S.eval(`document.querySelector('.se-photos')?.scrollIntoView(); true`);
    await j.shot(S, 'two-photos');
    // a text file and a huge noisy picture, through the real file input
    const txt = join(tmpdir(), 'not-a-photo.txt'); writeFileSync(txt, 'hello'); tmpFiles.push(txt);
    await giveFiles(S, [txt]); await sleep(1200); out['textFile'] = await note(S);
    const big = join(tmpdir(), 'huge-noise.png'); const png = noisePng(1800, 1800); writeFileSync(big, png); tmpFiles.push(big);
    detail['hugeFileBytes'] = png.length;
    await giveFiles(S, [big]); await S.waitFor(`/too big|could not|not accepted|Photo added|too large/i.test((document.querySelector('[data-note]')||{}).innerText||'')`, 40000, 'a note on the huge picture').catch(() => undefined);
    out['hugePicture'] = await note(S); out['thumbsAfter'] = await S.eval<number>(`document.querySelectorAll('.se-thumbs li').length`);
    await j.shot(S, 'huge-photo');
    // the server's own refusal for an oversized upload (the page shrinks first, so this goes around it)
    const over = await pageCall(S, '/api/showcase/mine/photos', { clientId: `${lab.now()}:${crypto.randomUUID()}`, type: 'image/jpeg', data: 'A'.repeat(300000) });
    out['serverOversize'] = { status: over.status, body: over.body };
    detail['refusals'] = out;
    for (const k of ['phoneInAbout', 'linkInAbout', 'badPayHost']) must(out[k] && !/Saved/.test(String(out[k])), `${k}: no refusal shown (${out[k]})`);
    must(out['sendButtonWith2'] === false, 'Send for review is offered with 2 photos');
  });

  await j.run('5', 'Add the third photo and send for review; the banner says it is waiting', [S], async (detail) => {
    const p3 = await makePhoto(S, 'shop-3.jpg', 3); tmpFiles.push(p3);
    const have = await S.eval<number>(`document.querySelectorAll('.se-thumbs li').length`);
    await giveFiles(S, [p3]); await S.waitFor(`document.querySelectorAll('.se-thumbs li').length >= ${have + 1}`, 20000, 'photo 3');
    await S.click('.se-actions button', 'Send for review');
    await S.waitFor(`/review/i.test((document.querySelector('[data-status]')||{}).innerText||'')`, 12000, 'the waiting banner');
    detail['status'] = await statusLine(S); detail['note'] = await note(S);
    await S.eval(`document.querySelector('[data-showcase-editor]').scrollIntoView(); true`); await j.shot(S, 'waiting-top');
    await S.eval(`document.querySelector('.se-photos').scrollIntoView(); true`); await j.shot(S, 'waiting-photos');
  });

  await j.run('6', 'Operator: queue, approve through /api/mod/showcase', [S], async (detail) => {
    const queue = await lab.mod('/api/mod/showcase');
    detail['queue'] = JSON.stringify(queue).slice(0, 600);
    const shop = (queue['queue'] ?? queue['shops'] ?? [])[0];
    must(shop?.id, 'the shop is not in the operator queue');
    ids['shop'] = shop.id;
    const photo = await fetch(`${lab.base}/api/mod/showcase/photo/${shop.photos?.[0]?.id ?? shop.photos?.[0]}`, { headers: { Authorization: `Bearer ${(await import('./lab.ts')).OPERATOR}` } });
    detail['photoStatus'] = photo.status;
    const approved = await lab.mod('/api/mod/showcase', { action: 'approve', shop: shop.id });
    detail['approve'] = approved;
    must(approved.status === 'live' || approved['ok'] === true, `approve answered ${JSON.stringify(approved).slice(0, 160)}`);
  });

  await j.run('7', 'Buyer (signed in, adult): directory, filters, search; the shop sits under the market too', [B], async (detail) => {
    await openServices(B);
    await B.waitFor(`document.querySelectorAll('.sc-hit').length >= 1`, 15000, 'the shop in the directory');
    await j.shot(B, 'directory');
    detail['card'] = (await text(B, '.sc-hit')).replace(/\s+/g, ' ');
    // filters
    await B.eval(`(() => { const s = [...document.querySelectorAll('.sc-filters select')]; return s.length; })()`);
    const setSel = async (label: string, value: string) => { await B.eval(`(() => { const s = [...document.querySelectorAll('.sc-filters label')].find((l) => l.innerText.startsWith(${JSON.stringify(label)})).querySelector('select'); s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event('change', { bubbles: true })); })()`); await sleep(900); };
    await setSel('Kind', 'tech'); detail['techCount'] = await B.eval<number>(`document.querySelectorAll('.sc-hit').length`); await j.shot(B, 'filter-tech-empty');
    detail['emptyText'] = (await text(B, '.sc-app')).replace(/\s+/g, ' ').slice(-200);
    await setSel('Kind', 'salon'); detail['salonCount'] = await B.eval<number>(`document.querySelectorAll('.sc-hit').length`);
    await setSel('Where', 'here'); detail['hereCount'] = await B.eval<number>(`document.querySelectorAll('.sc-hit').length`);
    await B.type('.sc-filters input[type=search]', 'braids'); await B.click('.sc-filters button', 'Search'); await sleep(900);
    detail['searchHit'] = await B.eval<number>(`document.querySelectorAll('.sc-hit').length`);
    await B.type('.sc-filters input[type=search]', 'plumber'); await B.click('.sc-filters button', 'Search'); await sleep(900);
    detail['searchMiss'] = await B.eval<number>(`document.querySelectorAll('.sc-hit').length`);
    await j.shot(B, 'search-miss');
    must(detail['techCount'] === 0 && detail['salonCount'] === 1 && detail['hereCount'] === 1 && detail['searchHit'] === 1 && detail['searchMiss'] === 0, `filters/search: ${JSON.stringify(detail)}`);
  });

  await j.run('8', 'Buyer: open the shop page (sign, about, photos, services with the price label, hours, trust badge)', [B], async (detail) => {
    await B.type('.sc-filters input[type=search]', ''); await B.click('.sc-filters button', 'Search'); await sleep(700);
    await B.click('.sc-hit');
    await B.waitFor(`!!document.querySelector('.sp .sp-about')`, 15000, 'the shop page');
    await B.waitFor(`[...document.querySelectorAll('.sp-photos img')].every((i) => i.complete && i.naturalWidth > 0) && document.querySelectorAll('.sp-photos img').length >= 3`, 20000, 'the three photos to load');
    const page = (await text(B, '.sp')).replace(/\s+/g, ' ');
    detail['pageText'] = page;
    await j.shot(B, 'shop-top');
    await B.eval(`document.querySelector('.sp-photos').scrollIntoView(); true`); await j.shot(B, 'shop-photos');
    await B.eval(`document.querySelector('.sp-actions').scrollIntoView(); true`); await j.shot(B, 'shop-actions');
    for (const want of ['Braids by Ada', 'Ada Braids', 'Knotless braids', '₦25,000', 'Seller’s price, paid outside Allworld', 'Monday', 'Sunday', 'closed']) must(page.includes(want), `the shop page lacks "${want}"`);
    detail['badge'] = await text(B, '.sp-who');
    detail['photoCount'] = await B.eval<number>(`document.querySelectorAll('.sp-photos img').length`);
    must(/Phone|checked|verified/i.test(String(detail['badge'])), `no trust badge wording: ${detail['badge']}`);
  });

  await j.run('9', 'Buyer: Chat and Pay open the leaving sheet that names the destination and shows the safety line; Continue opens a new tab', [B], async (detail) => {
    await B.eval(`window.__opened = []; window.open = (...a) => { window.__opened.push(a); return null; }; true`);
    await B.click('.sp-actions button', 'Chat with the seller');
    const out: Record<string, unknown> = {};
    for (let i = 0; i < 3 && !(await visible(B, '[data-trust-leave]')); i++) {
      if (await visible(B, '.sp button', 'I am 18')) { out['adultPrompt'] = true; await B.click('.sp button', 'I am 18'); await sleep(700); await B.click('.sp-actions button', 'Chat with the seller'); }
      await sleep(900);
    }
    await B.waitFor(`!!document.querySelector('[data-trust-leave]')`, 10000, 'the leaving sheet');
    await sleep(600);
    out['chatSheet'] = (await text(B, '[data-trust-leave]')).replace(/\s+/g, ' ');
    await j.shot(B, 'leaving-chat');
    await B.click('[data-trust-leave] button', 'Continue');
    out['opened'] = await B.eval<unknown>(`window.__opened`);
    await sleep(500);
    await B.click('.sp-actions button', 'Pay the seller');
    await B.waitFor(`!!document.querySelector('[data-trust-leave]')`, 10000, 'the pay sheet');
    await sleep(600);
    out['paySheet'] = (await text(B, '[data-trust-leave]')).replace(/\s+/g, ' ');
    await j.shot(B, 'leaving-pay');
    await B.click('[data-trust-leave] button', 'Continue');
    out['openedAfterPay'] = await B.eval<unknown>(`window.__opened`);
    detail['sheets'] = out;
    must(String(out['chatSheet']).includes('wa.me') && /safe|pay|money|careful|trust/i.test(String(out['chatSheet'])), 'the chat sheet does not name wa.me and show a safety line');
    must(String(out['paySheet']).includes('paystack.com'), 'the pay sheet does not name the destination');
    const opened = out['openedAfterPay'] as any[][];
    must(opened.length === 2 && opened[0]![0] === CHAT && opened[1]![0] === PAY && String(opened[0]![2]).includes('noopener'), 'Continue did not open the two links in a new tab with noopener');
  });

  await j.run('10', 'Guest: can browse and open the shop; Chat/Pay ask to sign in and no link is revealed (also in the payloads)', [G], async (detail) => {
    await openServices(G);
    await G.waitFor(`document.querySelectorAll('.sc-hit').length >= 1`, 15000, 'the directory as a guest');
    await G.click('.sc-hit');
    await G.waitFor(`!!document.querySelector('.sp .sp-about')`, 15000, 'the shop as a guest');
    await G.click('.sp-actions button', 'Chat with the seller');
    await sleep(1500);
    detail['afterChat'] = (await text(G, '.sp')).replace(/\s+/g, ' ').slice(-300);
    await j.shot(G, 'guest-chat');
    await G.click('.sp-actions button', 'Pay the seller').catch(() => undefined);
    await sleep(1200);
    await j.shot(G, 'guest-pay');
    detail['leavingSheet'] = await visible(G, '[data-trust-leave]');
    detail['signInButton'] = await visible(G, '.sp button', 'Sign in');
    // network: every showcase response the guest page and the buyer page received
    const leaked: string[] = [];
    for (const [who, p] of [['guest', G], ['buyer', B]] as const) {
      for (const r of p.requests.filter((x) => x.url.includes('/api/showcase/') && !x.url.includes('/photo/') && !x.url.includes('/go'))) {
        const body = (await p.responseBody(r.requestId)) ?? '';
        if (/wa\.me|paystack|https?:\/\//i.test(body)) leaked.push(`${who} ${r.method} ${r.url.replace(lab.base, '')}`);
      }
    }
    detail['payloadsWithUrls'] = leaked;
    const dir = await lab.call('/api/showcase/directory'), one = await lab.call(`/api/showcase/${ids['shop']}`);
    detail['anonymousDirectoryHasLink'] = /wa\.me|paystack/.test(JSON.stringify(dir)); detail['anonymousShopHasLink'] = /wa\.me|paystack/.test(JSON.stringify(one));
    const go = await lab.call(`/api/showcase/${ids['shop']}/go`, { clientId: `${lab.now()}:${crypto.randomUUID()}`, kind: 'chat' });
    detail['anonymousGo'] = { status: go.status, error: go['error'], hasUrl: /wa\.me/.test(JSON.stringify(go)) };
    must(!detail['leavingSheet'], 'a guest got the leaving sheet');
    must(leaked.length === 0 && !detail['anonymousDirectoryHasLink'] && !detail['anonymousShopHasLink'] && !(detail['anonymousGo'] as any).hasUrl, 'a link appears where it must not');
    must(detail['signInButton'], 'no sign-in prompt for the guest');
  });

  await j.run('11', 'Seller edits the pay link: leaves the directory; after approval "Payment details changed recently" shows', [S, B], async (detail) => {
    // the seller has had the editor open since before the operator approved: the first Save meets a stale revision
    await S.eval(`document.querySelector('[data-showcase-editor]').scrollIntoView(); true`);
    await fill(S, 'Payment link', PAY2);
    detail['staleEditorSave'] = await saveShop(S);
    await j.shot(S, 'stale-editor-save');
    // a real seller reloads, opens My shop again and edits
    await S.goto(lab.base + '/'); await gameShown(S); await dismiss(S);
    await openServices(S); await tab(S, 'My shop');
    await S.waitFor(`document.querySelector('[data-showcase-editor]') && !document.querySelector('[data-showcase-editor]').innerText.includes('Loading')`, 15000, 'the editor');
    detail['statusAfterReload'] = await statusLine(S);
    await fill(S, 'Payment link', PAY2);
    detail['note'] = await saveShop(S);
    detail['status'] = await statusLine(S);
    const dir = await lab.call('/api/showcase/directory');
    detail['directoryAfterEdit'] = (dir['shops'] ?? []).length;
    must(detail['directoryAfterEdit'] === 0, 'the shop is still in the directory after a pay link change');
    await j.shot(S, 'edit-pay-review');
    const queue = await lab.mod('/api/mod/showcase');
    must((queue['queue'] ?? []).some((s: any) => s.id === ids['shop']), 'the changed shop is not back in the queue');
    await lab.mod('/api/mod/showcase', { action: 'approve', shop: ids['shop'] });
    await B.goto(lab.base + '/'); await gameShown(B); await dismiss(B); await openServices(B);
    await B.click('.sc-hit'); await B.waitFor(`!!document.querySelector('.sp .sp-about')`, 15000, 'the shop page again');
    await B.waitFor(`!!document.querySelector('.sp-warn')`, 8000, 'the payment notice').catch(() => undefined);
    detail['notice'] = (await text(B, '.sp-warn').catch(() => '')) || '';
    await B.eval(`document.querySelector('.sp-warn')?.scrollIntoView({ block: 'center' }); true`); await j.shot(B, 'pay-notice');
    must(/Payment details changed recently/.test(String(detail['notice'])), 'no "Payment details changed recently" notice');
  });

  await j.run('12', 'No provider name in the showcase UI (the destination site on the leaving sheet excepted)', [B], async (detail) => {
    const names = /whatsapp|paystack|flutterwave|telegram|wa\.me|facebook|instagram/i;
    const hits: string[] = [];
    // buyer: browse, shop page; seller: editor (the editor text included)
    const shopText = await text(B, '.sp'); if (names.test(shopText)) hits.push('shop page');
    await B.click('.sp .ui-button', 'Back to the list'); await sleep(500);
    const listText = await text(B, '.sc-app'); if (names.test(listText)) hits.push('directory');
    const edText = await text(S, '[data-showcase-editor]'); const edHits = edText.match(names); if (edHits) hits.push(`editor: ${edHits[0]}`);
    const ph = await S.eval<string[]>(`[...document.querySelectorAll('.se input, .se textarea')].map((e) => (e.placeholder || '') + '|' + (e.getAttribute('aria-label') || '')).filter((x) => /whatsapp|paystack|flutterwave|telegram/i.test(x))`);
    if (ph.length) hits.push(`placeholders: ${ph}`);
    detail['hits'] = hits;
    must(hits.length === 0, `a provider name appears: ${hits.join('; ')}`);
  });

  await j.run('13', 'Simulated phone 390x844 and 320x568: editor, directory, shop page and the leaving sheet', [S, B], async (detail) => {
    const res: Record<string, unknown> = {};
    for (const [w, h] of [[390, 844], [320, 568]] as [number, number][]) {
      for (const p of [S, B]) await phone(p, w, h);
      await sleep(900);
      const out: Record<string, unknown> = {};
      await S.eval(`document.querySelector('[data-showcase-editor]').scrollIntoView(); true`); await j.shot(S, `phone${w}-editor-top`);
      out['editor'] = await layoutProbe(S, '[data-showcase-editor]');
      await S.eval(`document.querySelector('.se-photos').scrollIntoView(); true`); await j.shot(S, `phone${w}-editor-photos`);
      await B.click('.sp .ui-button', 'Back to the list').catch(() => undefined);
      await B.waitFor(`document.querySelectorAll('.sc-hit').length >= 1`, 10000, 'directory');
      await j.shot(B, `phone${w}-directory`); out['directory'] = await layoutProbe(B, '.sc-app');
      await B.click('.sc-hit'); await B.waitFor(`!!document.querySelector('.sp .sp-about')`, 15000, 'shop');
      await j.shot(B, `phone${w}-shop`); out['shop'] = await layoutProbe(B, '.sp');
      await B.eval(`window.__opened = []; window.open = (...a) => { window.__opened.push(a); return null; }; document.querySelector('.sp-actions').scrollIntoView({ block: 'center' }); true`);
      await B.click('.sp-actions button', 'Chat with the seller'); await B.waitFor(`!!document.querySelector('[data-trust-leave]')`, 10000, 'sheet'); await sleep(700);
      await j.shot(B, `phone${w}-leaving`); out['sheet'] = await layoutProbe(B, '[data-trust-leave]');
      out['sheetContinueReachable'] = await B.eval<boolean>(`(() => { const b = [...document.querySelectorAll('[data-trust-leave] button')].find((x) => /Continue/.test(x.innerText)); if (!b) return false; b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return r.bottom <= innerHeight + 1 && (top === b || b.contains(top)); })()`);
      await B.click('[data-trust-leave] button', 'Continue'); out['openedByTouch'] = await B.eval<unknown>(`window.__opened.length`);
      await B.click('.sp .ui-button', 'Back to the list').catch(() => undefined);
      res[`${w}x${h}`] = out;
    }
    detail['sizes'] = res;
    for (const p of [S, B]) await desktop(p);
  });
} catch (e) { console.log('ERR', e); }
finally {
  const code = j.finish({ ids }, { seller: realErrors(S), buyer: realErrors(B), guest: realErrors(G) });
  try { G.close(); B.close(); S.close(); } catch { /* closed */ }
  await lab.stop(); process.exit(code);
}
