/**
 * OWNER: growth
 * Events: the Phone app. What is on now and this week, where, a Go button, "add to my calendar"
 * (a file the phone's own calendar opens — nothing is sent anywhere) and spraying at a party.
 * The calendar itself is data (src/game/content/calendar.js) read by pure functions
 * (src/game/calendar.js); the list is computed here from the server's clock, with no request.
 */
import { esc, json, money, mark, empty } from '../dom.js';
import { how, rules as ruleList, bindHow } from '../phone/how.js';
import { upcomingEvents, eventIcs } from '../../game/calendar.js';
import { isDeparting } from '../../game/registry.js';
import { G, load, share, span, until, channelLink } from './growth-client.js';

const list = (view) => upcomingEvents(view.now, 7, view.cityId);

function card(event, state, view) {
  const here = state.location === event.venue && !isDeparting(state), attended = view.events?.live?.find((item) => item.key === event.key)?.attended;
  const spray = event.live && here && event.spray ? view.events.spray : null;
  return `<article class="gr-card"><h3>${esc(event.title)}${event.live ? '<span class="gr-live">On now</span>' : ''}</h3>
    <p class="gr-when">${esc(span(event.start, event.end))} · ${esc(event.venueLabel)}${event.live ? ` · ends in ${esc(until(event.end, view.now))}` : ` · starts in ${esc(until(event.start, view.now))}`}</p>
    <p>${esc(event.blurb)}${attended ? ' <b>You were there.</b>' : event.live && here ? ' You are here: finish any activity to count as there.' : ''}</p>
    ${spray ? `<p>Spray: ${spray.amounts.map((amount) => `<button class="ui-button" data-e-spray="${amount}" ${amount > spray.left || amount > state.cash ? 'disabled' : ''}>${money(amount)}</button>`).join('')}<br><small>${money(spray.left)} left to spray today. Spraying is for show: it lifts Social and Fun and the money is gone.</small></p>` : ''}
    ${here ? '' : `<button class="ui-button${event.live ? ' is-primary' : ''}" data-e-go="${esc(event.venue)}">Go there</button>`}
    <button class="ui-button" data-e-cal="${json({ key: event.key })}">Add to my calendar</button>
    <button class="ui-button" data-e-share="${esc(event.id)}" ${G.busy ? 'disabled' : ''}>Share</button></article>`;
}

const panel = {
  id: 'events', title: 'Events', placement: 'phone', order: 41, group: 'city',
  badge: (state, view) => (view.events?.live?.some((event) => !event.attended) ? 1 : 0),
  notifications(state, view) {
    if (!view.connected) return [];
    return list(view).filter((event) => event.live).map((event) => ({ id: `event:${event.key}`, at: event.start, fresh: !view.events?.live?.find((item) => item.key === event.key)?.attended, app: 'events', text: `On now: ${event.title} at ${event.venueLabel}` }));
  },
  render(state, view) {
    const events = list(view), live = events.filter((event) => event.live), later = events.filter((event) => !event.live);
    const channel = G.hello?.channel ? `${channelLink()}<p class="gr-note">The owner posts what is on tonight there. It opens WhatsApp; the game sends you nothing.</p>` : '';
    return `${live.length ? live.map((event) => card(event, state, view)).join('') : empty('calendar', 'Nothing is on right now', later[0] ? `Next: ${later[0].title}, ${span(later[0].start, later[0].end)}.` : 'Check back soon.', '', { compact: true })}
      ${later.length ? `<h3 class="ui-section">Coming up<small>next 7 days</small></h3>${later.map((event) => card(event, state, view)).join('')}` : ''}${channel}
      ${how('events-rules', ruleList(['Events happen at a place and a time, on Lagos time. Be there and finish any activity to count as attending.', 'An event changes no price and no pay. Being there counts for missions.',
    'Events come round again: weekly ones every week, yearly ones every year. Nothing is gone for ever.', '“Add to my calendar” makes a calendar file on your phone. The game sends no reminder by itself.']))}
      <p class="gr-note">${view.events?.count ?? 0} event${view.events?.count === 1 ? '' : 's'} attended so far.</p>`;
  },
  bind(root, api) {
    bindHow(root, api);
    void load(api);
    const each = (selector, handler) => { for (const node of root.querySelectorAll(selector)) node.addEventListener('click', () => handler(node)); };
    each('[data-e-go]', (node) => { api.close(); api.goTo(node.dataset.eGo); });
    each('[data-e-share]', (node) => share(api, 'event', { event: node.dataset.eShare }));
    each('[data-e-spray]', async (node) => { const result = await api.command('events.spray', { amount: Number(node.dataset.eSpray) }); if (result.ok) api.toast(api.state().message, 'spend'); });
    each('[data-e-cal]', (node) => {
      const event = list(api.view()).find((item) => item.key === JSON.parse(node.dataset.eCal).key);
      if (!event) return;
      const url = URL.createObjectURL(new Blob([eventIcs(event, location.origin)], { type: 'text/calendar' }));
      const link = Object.assign(document.createElement('a'), { href: url, download: `${event.id}.ics` });
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      api.toast('Calendar file made. Open it to add the event to your calendar.', 'info');
    });
  },
};

export default [panel];
