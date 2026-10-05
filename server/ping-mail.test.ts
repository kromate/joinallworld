// OWNER: growth — the ping mail as a document (server/growth/email/ping.ts): what it says, that hostile names and places
// are only ever text, that nothing in it is fetched or reports back, that its text part says what its HTML part says, and
// that the only addresses in it are the ones it was given.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pingMail } from './growth/email/ping.ts';
import { accountWelcomeMail } from './growth/email/templates.ts';
import { PING } from '../src/game/ping.ts';

const ORIGIN = 'https://play.example';
const JOIN = `${ORIGIN}/j/${'Ab1_-'.repeat(19)}`;
const links = { origin: ORIGIN, stopUrl: `${ORIGIN}/e/unsub?t=STOP.sig`, unsubscribeUrl: `${ORIGIN}/e/unsub?t=ALL.sig` };
const make = (over: Partial<Parameters<typeof pingMail>[0]> = {}) => pingMail({ from: 'Ada', place: 'at Freedom Park, Lagos', joinUrl: JOIN, links, contact: 'Allworld, 1 Example Street', ...over });
/** The words of an HTML document: tags, styles and comments out, entities back to characters. */
const wordsOf = (html: string): string => html.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<title[\s\S]*?<\/title>/g, ' ').replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

test('what it says: who, where, one button, that they land right there, how long, and why they got it', () => {
  const mail = make();
  assert.equal(mail.subject, 'Ada is waiting for you in Allworld');
  assert.equal(mail.text, [
    'Ada is waiting for you', '',
    'Ada is in Allworld right now, at Freedom Park, Lagos, and pinged you to come.',
    'Press the button and you land right where Ada is, ready to play and talk.', '',
    `Join Ada: ${JOIN}`, '',
    'Good for 60 minutes: The invitation is live while Ada is still in the game. If they have left when you arrive, the button simply opens Allworld and you can send them a message.', '',
    'The link was made for you and does not sign anybody in: you play as yourself, on a device where you already play or after you log in.', '',
    'You get this because Ada, a friend of yours in Allworld, pinged you, and you asked Allworld to e-mail you about your friends. A friend’s ping reaches you at most 2 times a day, never at night.',
    `Stop e-mails about my friends: ${links.stopUrl}`, `Unsubscribe from everything: ${links.unsubscribeUrl}`, `Change what I get: ${ORIGIN}/?go=touch`, 'Allworld, 1 Example Street',
  ].join('\n'));
  assert.equal(PING.liveMinutes, 60);
  assert.equal(PING.mail.recipientPerDay, 2);
  assert.match(make({ source: 'account' }).text, /and your Allworld account e-mails you about your friends\./);
  assert.match(mail.html, new RegExp(`<a href="${JOIN.replace(/[.?]/g, '\\$&')}"[^>]*>Join Ada</a>`));
  assert.equal((mail.html.match(/border-radius:999px">Join Ada<\/a>/g) ?? []).length, 1, 'one button');
});

test('the text part says what the HTML part says', () => {
  const mail = make(), seen = wordsOf(mail.html);
  /** What one line of the text part says: a link is written "label: address", the boxed note "title: text". */
  const pieces = (line: string): string[] => { const link = /^(.*?): https:\/\/\S+$/.exec(line); if (link) return [link[1] ?? '']; const cut = line.startsWith('Good for') ? line.indexOf(': ') : -1; return cut < 0 ? [line] : [line.slice(0, cut), line.slice(cut + 2)]; };
  const lines = mail.text.split('\n').filter(Boolean);
  for (const line of lines) {
    for (const piece of pieces(line)) assert.ok(seen.includes(piece), `the HTML says: ${piece}`);
    const address = /: (https:\/\/\S+)$/.exec(line)?.[1];
    if (address) assert.ok(mail.html.includes(`href="${address.replace(/&/g, '&amp;')}"`), `the HTML links to ${address}`);
  }
  // And the HTML says nothing more: what is left is its header, the line a mail program shows beside the subject, and the address written out under the button.
  let rest = seen;
  for (const piece of lines.flatMap(pieces).sort((x, y) => y.length - x.length)) rest = rest.replace(piece, ' ');
  assert.equal(rest.replace(/[·\s]+/g, ' ').trim(), `Ada is at Freedom Park, Lagos. Join them and you land right there. Allworld The whole world, to live in Or copy this address into your browser: ${JOIN}`);
});

test('a hostile name or place is only ever text', () => {
  const name = '<img src=x onerror=alert(1)>"\'&', place = 'at <script>fetch("//evil.example")</script> & "Co", Lagos';
  const mail = make({ from: name, place });
  assert.ok(!/<img|<script|onerror=alert\(1\)>/i.test(mail.html.replace(/<style>[\s\S]*?<\/style>/, '')), 'no markup from a name or a place');
  assert.ok(mail.html.includes('&lt;img src=x onerror=alert'), 'the name is escaped');
  assert.ok(mail.html.includes('&lt;script&gt;fetch(&quot;//evil.example&quot;)&lt;/script&gt; &amp; &quot;Co&quot;'));
  assert.equal((mail.html.match(/<a /g) ?? []).length, 4, 'the button and the three footer links: a name cannot add one');
  // A name is one bounded line: no control characters, no line breaks in the subject.
  const odd = make({ from: 'A\r\nBcc: x@evil.example\u0000' + 'z'.repeat(80), place: 'at a\nplace' });
  assert.ok(!/[\r\n\u0000]/.test(odd.subject));
  assert.equal(odd.subject, 'A Bcc: x@evil.example zz is waiting for you in Allworld');
  assert.ok(odd.text.split('\n')[2]?.startsWith('A Bcc: x@evil.example zz is in Allworld right now, at a place, and pinged'));
  assert.equal(make({ from: '', place: '' }).subject, 'A friend is waiting for you in Allworld');
});

test('nothing is fetched when it is read, nothing reports back, and every address in it is one it was given', () => {
  for (const mail of [make(), make({ source: 'account', contact: '' }), make({ from: '<b>x</b>', place: 'at "x", <y>' })]) {
    assert.ok(!/<img|<picture|<video|<audio|<iframe|<object|<embed|<link|<script|<form|<input|<svg|background=|srcset=|\bsrc=|url\(|@import|@font-face/i.test(mail.html), 'no image, no script, no form, nothing loaded');
    const hrefs = [...mail.html.matchAll(/href="([^"]*)"/g)].map((match) => (match[1] ?? '').replace(/&amp;/g, '&'));
    assert.deepEqual(hrefs.sort(), [JOIN, links.stopUrl, links.unsubscribeUrl, `${ORIGIN}/?go=touch`].sort());
    const urls = [...`${mail.html}\n${mail.text}`.matchAll(/https?:\/\/[^\s"'<>)]+/g)].map((match) => match[0].replace(/&amp;/g, '&'));
    for (const url of urls) assert.ok([JOIN, links.stopUrl, links.unsubscribeUrl, `${ORIGIN}/?go=touch`].includes(url), `an address it was not given: ${url}`);
    // The join link is the plain address: no redirect, no counter, no identifier beside the token.
    assert.ok(!/[?&](utm_|track|open|click|pixel|mid|rid)=/i.test(`${mail.html}${mail.text}`));
  }
});

test('it has the look of the welcome message: the same header, card, button and dark colours', () => {
  const mail = make().html, welcome = accountWelcomeMail({ name: 'Ada', playUrl: `${ORIGIN}/` }).html;
  const style = (html: string): string => /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? '';
  assert.equal(style(mail), style(welcome));
  for (const piece of ['background-image:linear-gradient(135deg,#2f8055 0%,#256b45 55%,#1b5235 100%)', 'max-width:560px', 'class="aw-card" bgcolor="#ffffff"', 'padding:14px 34px', '<meta name="color-scheme" content="light dark">', 'The whole world, to live in']) {
    assert.ok(mail.includes(piece) && welcome.includes(piece), piece);
  }
});
