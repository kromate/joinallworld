/**
 * OWNER: growth
 * Bring a friend: the Phone app. Your invite link (shared through the phone's own apps — the game
 * sends nothing), who came through it and where each of them is on the way to counting, and the
 * share sheet every Share button in the growth apps opens.
 * Rules: server/growth/referral.ts; numbers: src/game/content/growth.js.
 */
import { esc, money, mark, avatar, empty } from '../dom.ts';
import { how, rules as ruleList, bindHow } from '../phone/how.ts';
import { linkWords } from '../link.ts';
import { G, load, share, shareNow, copyShare } from './growth-client.js';

const STATE = { joined: 'Made a Sim · has not worked two days yet', counted: 'Playing · counted' };

const refer = {
  id: 'refer', title: 'Bring a friend', short: 'Friends', placement: 'phone', order: 39, group: 'people',
  badge: () => G.hello?.referral?.owed || 0,
  render(state, view) {
    if (!view.connected) return `<p class="gr-note">${esc(linkWords(view).why)}</p>`;
    const r = G.hello?.referral;
    if (!r) return `<p class="gr-note">${G.error ? esc(G.error) : 'Loading your invites…'}</p>`;
    const rules = r.rules, paid = r.paid;
    const friends = r.invited.map((friend) => `<li class="ui-row">${avatar(friend.name, friend.id)}<span class="ui-row-body"><b>${esc(friend.name)}</b><small>${esc(STATE[friend.state] ?? friend.state)}</small></span>${friend.state === 'counted' ? '<span class="ui-row-end"><span class="ui-chip is-good">Counted</span></span>' : ''}</li>`).join('');
    return `<section class="ui-hero gr-hero"><small>Bring a friend</small><strong>${r.counted} friend${r.counted === 1 ? '' : 's'} playing because of you</strong>
        <p>${r.title ? `Your title: ${esc(r.title)}. ` : ''}${r.nextTitle ? `${r.nextTitle.count - r.counted} more for “${esc(r.nextTitle.label)}”.` : ''}</p></section>
      <div class="gr-card"><h3>Your invite link</h3><p>Send it in WhatsApp or anywhere else. Your friend picks a name and is in: no sign-up. When they have been paid for work on ${rules.workDays} different days, you get ${money(rules.reward)} and ${rules.stars} stars. They get ${money(rules.welcome)} after their first paid day.</p>
        <button class="ui-button is-primary is-block" data-r-share="invite" ${G.busy ? 'disabled' : ''}>${G.busy === 'invite' ? 'Preparing…' : 'Share my invite link'}</button>
        <button class="ui-button is-block" data-r-share="house" ${G.busy ? 'disabled' : ''}>${G.busy === 'house' ? 'Preparing…' : 'Invite someone to my house'}</button></div>
      ${r.by ? `<div class="gr-card"><h3>You came through ${esc(r.by.name)}’s link</h3><p>${r.by.welcomed ? `Your ${money(rules.welcome)} welcome gift has been paid.` : `Finish a paid shift or gig and ${money(rules.welcome)} is yours.`} ${r.by.counted ? `${esc(r.by.name)} has been thanked.` : `Work on ${rules.workDays} different days and ${esc(r.by.name)} is rewarded too.`}</p>
        <button class="ui-button" data-open="invite" data-params="${esc(JSON.stringify({ host: r.by.id }))}">Go to their door</button></div>` : ''}
      <h3 class="ui-section">Came through your link<small>${r.invited.length}</small></h3>
      ${friends ? `<ul class="ui-rows">${friends}</ul>` : empty('people', 'Nobody yet', 'Share your link with one friend to start.', '', { compact: true })}
      ${paid ? `<p class="gr-note">Rewards paid: ${paid.paidThisWeek} of ${paid.perWeek} this week, ${paid.paidTotal} of ${paid.lifetime} for life.${r.owed ? ` ${r.owed} waiting for next week.` : ''} After that friends still count for your titles.</p>` : ''}
      ${how('refer-rules', ruleList([`A link counts in the first ${rules.linkWithinDays} days of your friend’s life, once, on their own phone.`, 'Nothing is paid for sharing itself, and nothing for an account that never plays.',
    `At most ${rules.perWeek} rewards a week and ${rules.lifetime} for life. Reward money cannot be gifted on.`, 'The game never messages your friends. You send the link yourself, to whoever you choose.']))}`;
  },
  bind(root, api) {
    bindHow(root, api);
    void load(api);
    for (const node of root.querySelectorAll('[data-r-share]')) node.addEventListener('click', () => share(api, node.dataset.rShare));
  },
};

const sheet = {
  id: 'share-sheet', title: 'Share', icon: 'share', placement: 'modal', live: false,
  render() {
    const s = G.sharing;
    if (!s) return '<p class="gr-note">Nothing to share yet.</p>';
    const p = s.prepared;
    return `${p.url ? `<img class="gr-share-img" src="${esc(p.url)}" alt="Your Allworld card" width="320" height="320">` : ''}
      <p class="gr-share-text" data-s-text>${esc(p.text)}</p>
      <div class="gr-share-acts"><button class="ui-button is-primary is-wide" data-s-now>${mark('share')} Share…</button>
        <a class="ui-button" href="${esc(p.whatsapp)}" target="_blank" rel="noopener noreferrer">WhatsApp</a><a class="ui-button" href="${esc(p.x)}" target="_blank" rel="noopener noreferrer">X</a>
        <button class="ui-button" data-s-copy>Copy text</button>${p.url ? `<a class="ui-button" href="${esc(p.url)}" download="allworld.jpg">Save picture</a>` : ''}</div>
      <p class="gr-note">You choose who sees this. The link is the last line: delete it if you only want the result. Sharing pays nothing; a friend who really plays does.</p>`;
  },
  bind(root, api) {
    root.querySelector('[data-s-now]')?.addEventListener('click', () => shareNow(api));
    root.querySelector('[data-s-copy]')?.addEventListener('click', () => copyShare(api));
  },
};

export default [refer, sheet];
