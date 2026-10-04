// The map's venue card and the Ride app say WHY a trip cannot start in the words of the real connection state.
import test from 'node:test';
import assert from 'node:assert/strict';
import { goBlock, fixButton, tripInfo, modeIcon, placeName } from './world-ui.js';
import { LINK_STATES, linkWords, linkAttrs, linkButton } from '../link.js';

const destination = { id: 'cchub', label: 'CcHub', status: 'Open', modes: [{ id: 'danfo', label: 'Danfo', fare: 150, seconds: 8 }] };
const mode = destination.modes[0];
const state = { cash: 1000, location: 'home', activeAction: null };
const block = (view) => goBlock(state, { travel: { destinations: [destination] }, ...view }, destination, mode);

test('Go is blocked with the truthful words and the right action for every connection state', () => {
  assert.equal(block({ connected: true, link: 'online' }), null, 'connected: nothing stops the trip');
  const seen = {};
  for (const link of LINK_STATES.filter((name) => name !== 'online')) {
    const result = block({ connected: false, link }), words = linkWords(link);
    seen[link] = result;
    assert.equal(result.code, 'offline', 'the code stays "offline" for every not-connected state (a code, not wording)');
    assert.equal(result.link, link);
    assert.equal(result.label, words.short, 'the Go button carries the short words of that state');
    assert.ok(result.reason.startsWith(words.why.replace(/\.$/, '')), `${link}: the reason starts with what is true`);
    // "Offline" is said only when this device has no network.
    if (link !== 'offline') assert.doesNotMatch(`${result.label} ${result.reason} ${result.fix?.label ?? ''}`, /offline/i, link);
  }
  assert.equal(seen.offline.label, 'No internet');
  assert.match(seen.offline.reason, /no internet connection, so the trip cannot start\. Reconnect and Go will work again/);
  assert.match(fixButton(seen.offline), /^<button class="map-fix" data-menu="reconnect">Try again<\/button>$/);
  assert.equal(seen.unreachable.label, 'Server unreachable');
  assert.match(seen.unreachable.reason, /server is not answering, so the trip cannot start\. Your life is safe there/);
  assert.match(fixButton(seen.unreachable), /data-menu="reconnect">Try again</);
  assert.equal(seen.expired.label, 'Saved life not found');
  assert.match(fixButton(seen.expired), /data-open-gate="expired">Start a new life</, 'an expired life offers a new life, not "reconnect"');
  assert.equal(seen.new.label, 'Not started');
  assert.match(seen.new.reason, /^You have not started a life yet\. Choose a nickname to start a session on this device, then travel\.$/);
  assert.match(fixButton(seen.new, 'ride-fix'), /^<button class="ride-fix" data-open-gate="new">Choose a nickname<\/button>$/);
  assert.equal(seen.connecting.label, 'Connecting…');
  assert.equal(seen.connecting.fix, null, 'still connecting: nothing to press, it resolves by itself');
  assert.equal(fixButton(seen.connecting), '');
  // A host that sends no `link` at all is read as "server unreachable", never as "offline".
  assert.equal(block({ connected: false }).label, 'Server unreachable');
  assert.equal(block({ connected: false }).fix.kind, 'reconnect');
  // …and one with no session at all is a device that has not started a life.
  assert.equal(block({ connected: false, session: null }).label, 'Not started');
  assert.equal(block({ connected: false, session: null, link: 'offline' }).label, 'No internet', 'a reported state always wins');
});

test('the link helpers give every panel the same button for a state', () => {
  assert.equal(linkAttrs(null), '');
  assert.equal(linkButton('online'), '');
  assert.equal(linkButton('connecting'), '');
  assert.equal(linkButton({ connected: false, link: 'offline' }, 'x'), '<button type="button" class="x" data-menu="reconnect">Try again</button>');
  assert.equal(linkButton('new'), '<button type="button" class="ui-button" data-open-gate="new">Choose a nickname</button>');
  assert.equal(linkWords('unreachable').cannot('vote'), 'The game server is not answering. You cannot vote right now. Your life is safe there. Try again shortly.');
});

test('trips, modes and places are drawn with glyphs, never with the content emoji', () => {
  const view = { connected: true, travel: { destinations: [destination, { id: 'home', label: 'Home', icon: '🏠' }], modes: [{ id: 'okada', label: 'Okada', icon: '🏍️' }], active: { from: 'home', fare: 200 } } };
  const trip = tripInfo({ location: 'home', activeAction: { kind: 'travel', id: 'cchub', mode: 'okada', duration: 10, remaining: 4 } }, view);
  assert.equal(trip.mode.id, 'okada');
  assert.match(modeIcon(trip.mode), /^<svg class="ui-glyph"/);
  assert.match(modeIcon({ id: 'commute', label: 'Commute to work' }), /^<svg class="ui-glyph"/);
  assert.match(placeName({ id: 'home', label: 'Home', icon: '🏠' }), /^<svg class="ui-glyph"[^]*<\/svg> Home$/);
  assert.doesNotMatch(placeName({ id: 'nowhere', label: 'A <place>' }), /\p{Extended_Pictographic}/u);
  assert.match(placeName({ id: 'nowhere', label: 'A <place>' }), /A &lt;place&gt;$/);
});
