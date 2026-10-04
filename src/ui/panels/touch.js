/**
 * OWNER: growth
 * Stay in touch: the Phone app where a player decides whether the game may reach them outside the
 * game, and reads exactly what it would say. The age question comes first; under 18, no outside
 * message is offered at all. Every channel is off until the player turns it on — notifications by
 * the browser's own permission, e-mail by a consent tick and a confirmation link — and one tap
 * turns each off again and deletes what was stored for it.
 * Rules: server/growth/outreach.js and src/game/outreach.js; the words: src/game/digest.js.
 */
import { esc } from '../dom.ts';
import { how, rules as ruleList, bindHow } from '../phone/how.ts';
import { linkWords } from '../link.ts';
import { EMAIL_CONSENT, PUSH_CONSENT } from '../../game/outreach.ts';
import { G, load, call, track, announceAge } from './growth-client.js';

const ui = { busy: null, email: '', tick: false, pushAsk: false, note: null };
const push = () => import('../push-client.ts');
let pushKind = null; // 'ready' | 'unsupported' | 'needs-install' | 'blocked', once known

async function saveAge(api, age) {
  ui.busy = 'age'; api.refresh();
  const result = await call('/api/growth/consent', { age });
  ui.busy = null;
  if (result.consent && G.hello) G.hello.consent = result.consent;
  // The one stored answer is announced: analytics follows it (under 18 → off) as e-mail and push do.
  announceAge(result.consent?.age);
  if (!result.ok && result.code !== 'under_18') api.toast(result.reason || 'That could not be saved.', 'error');
  api.refresh();
}
async function done(api) { ui.busy = null; await load(api, { force: true }); api.refresh(); }

async function switchPushOn(api) {
  ui.busy = 'push'; api.refresh();
  const key = await call('/api/growth/push/key');
  const outcome = key.ok ? await (await push()).enablePush(key.publicKey) : { ok: false, code: 'failed' };
  if (outcome.ok) {
    const saved = await call('/api/growth/push/subscribe', { subscription: outcome.subscription, consent: true });
    if (saved.ok) { track('push_prompt_accepted'); api.toast('Notifications are on for this phone.', 'good'); } else api.toast(saved.reason || 'That could not be saved.', 'error');
  } else {
    track('push_prompt_declined');
    pushKind = outcome.code === 'blocked' ? 'blocked' : pushKind;
    api.toast(outcome.code === 'blocked' ? 'This browser has notifications blocked for the game. Allow them in the browser’s site settings to switch this on.' : outcome.code === 'declined' ? 'No problem. Nothing was switched on.' : 'Notifications could not be switched on in this browser.', 'info');
  }
  ui.pushAsk = false;
  await done(api);
}
async function switchPushOff(api) {
  ui.busy = 'push'; api.refresh();
  await (await push()).disablePush();
  await call('/api/growth/push/unsubscribe', {});
  track('unsubscribed', { channel: 'push' });
  api.toast('Notifications are off. This phone’s subscription was deleted.', 'good');
  await done(api);
}
async function askEmail(api) {
  ui.busy = 'email'; api.refresh();
  const result = await call('/api/growth/email', { email: ui.email, consent: ui.tick });
  if (result.ok) { track('email_optin_started'); ui.note = result; ui.email = ''; ui.tick = false; api.toast(result.dryRun ? 'Address saved. E-mail is not switched on for this server yet, so nothing was sent.' : 'Check your inbox and press the button in the e-mail to confirm.', 'good'); }
  else api.toast(result.reason || 'That address was not accepted.', 'error');
  await done(api);
}
async function removeEmail(api) {
  ui.busy = 'email'; api.refresh();
  await call('/api/growth/email/remove', {});
  ui.note = null; track('unsubscribed', { channel: 'email' });
  api.toast('Your address was deleted. No more e-mails.', 'good');
  await done(api);
}

export function digestPreview(digest) {
  if (!digest) return '';
  return `<div class="gr-preview"><b>${esc(digest.subject)}</b>${esc(digest.greeting)}<ul>${digest.lines.map((line) => `<li>${esc(line)}</li>`).join('')}</ul>
    ${digest.more ? `<small>and ${digest.more} more</small>` : ''}<b>This week you could</b><ul>${digest.tasks.map((task) => `<li>${esc(task.text)}</li>`).join('')}</ul><small>${esc(digest.footer)}</small></div>`;
}

function pushCard(hello) {
  const on = hello.consent?.push === true, busy = ui.busy === 'push';
  if (on) return `<div class="gr-card"><h3>Notifications are on</h3><p>${hello.contact.push.devices} phone${hello.contact.push.devices === 1 ? '' : 's'} or browser${hello.contact.push.devices === 1 ? '' : 's'}. At most one a day and three a week, never between 10 pm and 7 am.</p><button class="ui-button" data-t-push-off ${busy ? 'disabled' : ''}>${busy ? 'Working…' : 'Switch off'}</button></div>`;
  if (pushKind === 'needs-install') return '<div class="gr-card"><h3>Notifications on iPhone and iPad</h3><p>Apple only allows them for a game added to the Home Screen. In Safari, tap Share, then “Add to Home Screen”, open Allworld from there and come back to this screen.</p></div>';
  if (pushKind === 'unsupported') return '<div class="gr-card"><h3>Notifications</h3><p>This browser cannot receive them. Chrome on Android can.</p></div>';
  if (pushKind === 'blocked') return '<div class="gr-card"><h3>Notifications are blocked</h3><p>This browser was told not to allow notifications from the game. You can change that in the browser’s site settings; the game cannot ask again.</p></div>';
  if (!ui.pushAsk) return `<div class="gr-card"><h3>Notifications on this phone</h3><p>A short note when someone is looking for you or something is on, even when the game is closed.</p><button class="ui-button is-primary" data-t-push-ask>Tell me more</button></div>`;
  return `<div class="gr-card"><h3>Switch notifications on?</h3><p>${esc(PUSH_CONSENT)}</p><p>Your phone will now ask you to allow them. If you say no there, nothing is switched on.</p>
    <button class="ui-button is-primary" data-t-push-on ${busy ? 'disabled' : ''}>${busy ? 'Asking…' : 'Yes, ask me'}</button><button class="ui-button" data-t-push-no>Not now</button></div>`;
}

function emailCard(hello) {
  const mine = hello.contact.email, busy = ui.busy === 'email';
  const dry = hello.contact.live.email ? '' : '<p class="gr-note">E-mail is not switched on for this server yet: messages are composed and shown here, and nothing is sent.</p>';
  if (mine?.confirmed) return `<div class="gr-card"><h3>E-mail is on</h3><p>${esc(mine.address)} · confirmed. At most one message a day and three a week.</p>${dry}
    ${mine.preview ? `<div class="gr-preview"><b>${esc(mine.preview.subject)}</b>${esc(mine.preview.text).replace(/\n/g, '<br>')}</div><p class="gr-note">The last message composed for you.</p>` : ''}<button class="ui-button" data-t-email-off ${busy ? 'disabled' : ''}>Delete my address</button></div>`;
  if (mine) return `<div class="gr-card"><h3>Confirm your address</h3><p>${esc(mine.address)} is waiting. Open the e-mail we sent and press the button in it. Nothing else is sent until you do.</p>${dry}
    ${ui.note?.confirmPath ? `<p><a class="ui-button" href="${esc(ui.note.confirmPath)}" target="_blank" rel="noopener">Open the confirmation page</a></p>` : ''}<button class="ui-button" data-t-email-off ${busy ? 'disabled' : ''}>Delete my address</button></div>`;
  return `<div class="gr-card"><h3>E-mail</h3><p>What happened while you were away, and a weekly summary with a few things to do.</p>
    <label class="gr-field">Your e-mail address<input type="email" inputmode="email" autocomplete="email" maxlength="254" data-t-email value="${esc(ui.email)}" placeholder="you@example.com"></label>
    <label class="gr-check"><input type="checkbox" data-t-tick ${ui.tick ? 'checked' : ''}><span>${esc(EMAIL_CONSENT)}</span></label>
    <button class="ui-button is-primary" data-t-email-on ${busy || !ui.tick || !ui.email ? 'disabled' : ''}>${busy ? 'Sending…' : 'Send the confirmation'}</button>${dry}</div>`;
}

const panel = {
  id: 'touch', title: 'Stay in touch', short: 'In touch', placement: 'phone', order: 94, group: 'life', live: false,
  render(state, view) {
    if (!view.connected) return `<p class="gr-note">${esc(linkWords(view).why)}</p>`;
    const hello = G.hello;
    if (!hello) return `<p class="gr-note">${G.error ? esc(G.error) : 'Loading…'}</p>`;
    const consent = hello.consent;
    const age = !consent ? `<div class="gr-card"><h3>First, how old are you?</h3><p>Messages outside the game are only for players who are 18 or older. Your answer is kept with this life and shown to nobody.</p>
        <button class="ui-button is-primary" data-t-age="adult" ${ui.busy ? 'disabled' : ''}>I am 18 or older</button><button class="ui-button" data-t-age="minor" ${ui.busy ? 'disabled' : ''}>I am under 18</button></div>`
      : consent.age === 'minor' ? '<div class="gr-card"><h3>You are all set</h3><p>You told us you are under 18, so the game will never message you outside the game. Everything inside it works the same: Updates, Missions and Events are right here on your Phone.</p></div>'
        : '';
    const channels = consent?.age === 'adult' ? `${pushCard(hello)}${emailCard(hello)}` : '';
    const whatsapp = hello.channel ? `<div class="gr-card"><h3>Allworld on WhatsApp</h3><p>The owner posts what is on tonight in a WhatsApp Channel. Following it is between you and WhatsApp: the game learns nothing and sends nothing.</p><a class="ui-button" href="${esc(hello.channel)}" target="_blank" rel="noopener noreferrer">Follow Allworld on WhatsApp</a></div>` : '';
    return `<section class="ui-hero gr-hero"><small>Stay in touch</small><strong>Only if you ask</strong><p>The game never contacts you unless you switch it on here. Nothing below is on by default.</p></section>
      ${age}${channels}${whatsapp}
      <div class="gr-card"><h3>In the game</h3><p>Updates, the “While you were away” card and the badges on your Phone are always here. They need no permission and leave the game for nowhere.</p></div>
      <h3 class="ui-section">What a weekly message says<small>preview</small></h3>${digestPreview(hello.digest)}
      <p class="gr-note">Drawn from your own life as it is now.</p>
      ${how('touch-rules', ruleList(['At most one message a day and three a week on each channel, never between 10 pm and 7 am Lagos time.', 'A message says what happened and what you could do. It never says you lost something by being away.',
    'If messages do not bring you back, they slow down (1, 3, then 7 days apart) and stop after four.', 'Switching a channel off deletes what was stored for it: your address, or this phone’s subscription.', 'Your address is shown to nobody, and never appears in a share, a profile or a list.']))}`;
  },
  bind(root, api) {
    bindHow(root, api);
    void load(api);
    if (pushKind === null) void push().then((module) => { pushKind = module.pushState(); api.refresh(); });
    const on = (selector, handler, event = 'click') => root.querySelector(selector)?.addEventListener(event, handler);
    for (const node of root.querySelectorAll('[data-t-age]')) node.addEventListener('click', () => saveAge(api, node.dataset.tAge));
    on('[data-t-push-ask]', () => { ui.pushAsk = true; track('push_prompt_shown'); api.refresh(); });
    on('[data-t-push-no]', () => { ui.pushAsk = false; track('push_prompt_declined'); api.refresh(); });
    on('[data-t-push-on]', () => switchPushOn(api));
    on('[data-t-push-off]', () => switchPushOff(api));
    // The form is not redrawn while typing (the panel is not live): only the button's state follows the fields.
    const button = root.querySelector('[data-t-email-on]');
    on('[data-t-email]', (event) => { ui.email = event.target.value.trim(); if (button) button.disabled = !ui.tick || !ui.email; }, 'input');
    on('[data-t-tick]', (event) => { ui.tick = event.target.checked; if (button) button.disabled = !ui.tick || !ui.email; }, 'change');
    on('[data-t-email-on]', () => askEmail(api));
    on('[data-t-email-off]', () => removeEmail(api));
  },
};

export default [panel];
