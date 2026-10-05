/**
 * OWNER: world
 * Other players on the city map: the player's friends where they stand or travel, and how many more players are
 * at a venue. Shared by the 3D map and the flat one, which only differ in how a map point becomes a screen point.
 *
 *   pinsOf(people, now, world)  → { pins, moving }     pure: who is drawn where at server time `now`
 *   createPinLayer(layer, doc)  → { render(pins, project, px, glide?), hit(target), destroy() }   a fixed pool of nodes
 *
 * A FRIEND'S TRIP IS THEIR SERVER'S TIMER, as the player's own is (trip.ts): it arrives as where from, where to,
 * the server time it began and how long it takes, and the place on the route is a function of the clock. Nothing
 * is streamed, and the route is the one the map draws for the player's own trip between the same two places.
 * A home is never a place on this map for anyone but its owner: a friend leaving home is shown at the venue they
 * are heading for, one going home stays at the venue they are leaving until the trip is over.
 *
 * BOUNDS. At most MAX_PINS nodes exist, friends before counts. Friends standing at one venue share one pin.
 *
 * TWO WAYS TO MOVE A PIN. The 3D map places the pins again on its own frames while one is travelling. The flat map
 * has no loop and no timer: it hands the rest of the trip to the browser as ONE animation of the node (`glide`),
 * made again only when the view or the data changes, and is told once when it has ended.
 */
import { tripPose } from './trip.ts';
import type { TripRoute } from './trip.ts';

/** A friend to draw. `venue` when standing somewhere, `trip` when on the way. */
export interface MapPerson {
  id: string
  name: string
  /** The letter and the colour of their avatar, as the people lists draw it. */
  initial: string
  hue: number
  venue?: string
  trip?: { from: string; to: string; mode: string; startedAt: number; duration: number }
}
/** `counts`: other players at each venue, not counting the player and not counting the friends in `people`. */
export interface MapPeople { people: readonly MapPerson[]; counts: Readonly<Record<string, number>> }
export interface PeoplePin {
  key: string
  /** One friend, several friends at one venue, or players who are not friends. */
  kind: 'friend' | 'group' | 'count'
  ids: string[]
  x: number
  z: number
  /** The venue the pin stands at; null while travelling. */
  venue: string | null
  text: string
  /** What a screen reader and a hover say. */
  title: string
  initial: string
  hue: number
  moving: boolean
  /** While travelling: the route and the timing, so the rest of the trip can be worked out without asking again. */
  path?: { route: TripRoute; mode: string; startedAt: number; duration: number }
}
/** For a map without a frame loop: the server time now, where a map point is on screen, and what to do when a trip has ended. */
export interface PinGlide { now: number; project(x: number, z: number): { x: number; y: number }; done(): void }
const GLIDE_STEPS = 20;
/** A travelling pin rides above its point of the road; a standing one hangs under the door, clear of the venue's own label above it. */
const ABOVE = 'translate(-50%,-100%)', BELOW = 'translate(-50%,5px)';
/** What the pins are placed with: where a venue's door is (null for a place this map does not show) and the road route between two. */
export interface PinWorld {
  place(id: string): { x: number; z: number } | null
  route(from: string, to: string): TripRoute | null
  /** A venue's name, for the words of a pin. */
  name?(id: string): string
}
export const MAX_PINS = 24;
export const EMPTY_PEOPLE: MapPeople = Object.freeze({ people: Object.freeze([]), counts: Object.freeze({}) });

const straight = (a: { x: number; z: number }, b: { x: number; z: number }): TripRoute => {
  const length = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  return { points: [{ x: a.x, y: 0, z: a.z, bridge: null }, { x: b.x, y: 0, z: b.z, bridge: null }], lengths: [0, length], length, lead: 0, tail: 0 };
};
/** The fraction of a trip done at server time `now`, 0…1. */
export const tripProgress = (trip: { startedAt: number; duration: number }, now: number): number => Math.max(0, Math.min(1, (now - trip.startedAt) / (Math.max(1, trip.duration) * 1000)));
const others = (count: number): string => `${count} other player${count === 1 ? '' : 's'}`;

/** Who is drawn where at `now`. `moving` is true while any pin still has ground to cover. */
export function pinsOf(input: MapPeople, now: number, world: PinWorld): { pins: PeoplePin[]; moving: boolean } {
  const pins: PeoplePin[] = [], standing = new Map<string, MapPerson[]>();
  const nameOf = (id: string): string => world.name?.(id) ?? id;
  const stand = (person: MapPerson, venue: string): void => { const list = standing.get(venue); if (list) list.push(person); else standing.set(venue, [person]); };
  let moving = false;
  for (const person of input.people) {
    if (pins.length + standing.size >= MAX_PINS) break;
    const trip = person.trip;
    if (!trip) { if (person.venue && world.place(person.venue)) stand(person, person.venue); continue; }
    const from = world.place(trip.from), to = world.place(trip.to), p = tripProgress(trip, now);
    if (from && to && p < 1) {
      const route = world.route(trip.from, trip.to) ?? straight(from, to), at = tripPose(route, p, trip.mode);
      pins.push({ key: `p:${person.id}`, kind: 'friend', ids: [person.id], x: at.x, z: at.z, venue: null, text: person.name, title: `${person.name}, on the way to ${nameOf(trip.to)}`, initial: person.initial, hue: person.hue, moving: true,
        path: { route, mode: trip.mode, startedAt: trip.startedAt, duration: trip.duration } });
      moving = true;
    } else if (to && (p >= 1 || !from)) stand(person, trip.to);
    else if (from && p < 1) { stand(person, trip.from); moving = true; }
  }
  for (const [venue, list] of standing) {
    const at = world.place(venue), first = list[0], more = input.counts[venue] ?? 0, total = list.length + more;
    if (!at || !first) continue;
    const names = list.map((person) => person.name).join(', ');
    pins.push({ key: list.length === 1 ? `p:${first.id}` : `v:${venue}`, kind: list.length === 1 ? 'friend' : 'group', ids: list.map((person) => person.id), x: at.x, z: at.z, venue,
      text: total === 1 ? first.name : list.length === 1 ? `${first.name} +${more}` : `${total} here`, title: `${names}${more ? ` and ${others(more)}` : ''} at ${nameOf(venue)}`, initial: first.initial, hue: first.hue, moving: false });
  }
  const counted = Object.entries(input.counts).filter(([venue, count]) => count > 0 && !standing.has(venue)).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  for (const [venue, count] of counted) {
    if (pins.length >= MAX_PINS) break;
    const at = world.place(venue);
    if (at) pins.push({ key: `c:${venue}`, kind: 'count', ids: [], x: at.x, z: at.z, venue, text: `${count} here`, title: `${others(count)} at ${nameOf(venue)}`, initial: '', hue: 0, moving: false });
  }
  return { pins: pins.slice(0, MAX_PINS), moving };
}

interface PinNode { node: HTMLButtonElement; dot: HTMLElement; text: HTMLElement; key: string; shown: string; glide: Animation | null }
/** The pool of pin nodes over a map. `project` says where a pin is on screen (or that it is out of sight); `px` writes a screen length. */
export function createPinLayer(layer: HTMLElement, doc: Document) {
  const nodes: PinNode[] = [];
  let current: PeoplePin[] = [];
  function nodeAt(index: number): PinNode {
    let entry = nodes[index];
    if (entry) return entry;
    const node = doc.createElement('button');
    node.type = 'button'; node.className = 'm3-person'; node.hidden = true;
    const dot = doc.createElement('i'), text = doc.createElement('b');
    dot.className = 'm3-person-dot'; dot.setAttribute('aria-hidden', 'true');
    node.append(dot, text); layer.append(node);
    entry = { node, dot, text, key: '', shown: '', glide: null };
    nodes.push(entry);
    return entry;
  }
  return {
    render(pins: readonly PeoplePin[], project: (pin: PeoplePin) => { x: number; y: number; visible: boolean }, px: (value: number) => string = (value) => `${Math.round(value)}px`, glide: PinGlide | null = null): void {
      current = pins.slice(0, MAX_PINS);
      for (const entry of nodes) if (entry.glide) { entry.glide.onfinish = null; entry.glide.cancel(); entry.glide = null; }
      current.forEach((pin, index) => {
        const entry = nodeAt(index), at = project(pin);
        const shown = `${pin.key}|${pin.kind}|${pin.text}|${pin.title}|${pin.hue}|${pin.moving}`;
        if (shown !== entry.shown) {
          entry.shown = shown; entry.key = pin.key;
          entry.node.className = `m3-person is-${pin.kind}${pin.moving ? ' is-moving' : ''}`;
          entry.node.dataset.pin = pin.key;
          entry.node.setAttribute('aria-label', pin.kind === 'count' ? pin.title : `${pin.title}. Open ${pin.ids.length === 1 ? 'their card' : 'the people list'}.`);
          entry.node.title = pin.title;
          entry.node.tabIndex = pin.kind === 'count' ? -1 : 0;
          entry.dot.textContent = pin.initial; entry.dot.style.setProperty('--hue', String(pin.hue));
          entry.text.textContent = pin.text; // a player's name: text, never markup
        }
        if (entry.node.hidden === at.visible) entry.node.hidden = !at.visible;
        if (at.visible) entry.node.style.transform = `translate(${px(at.x)},${px(at.y)}) ${pin.moving && pin.path ? ABOVE : BELOW}`;
        // The rest of the trip, as one animation the browser runs: from here to the door, in the time the server's timer has left.
        const path = pin.path, left = path ? path.startedAt + path.duration * 1000 - (glide?.now ?? 0) : 0;
        if (!glide || !path || left <= 0 || typeof entry.node.animate !== 'function') return;
        const from = tripProgress(path, glide.now), frames: Keyframe[] = [];
        for (let step = 0; step <= GLIDE_STEPS; step++) {
          const pose = tripPose(path.route, from + ((1 - from) * step) / GLIDE_STEPS, path.mode), spot = glide.project(pose.x, pose.z);
          frames.push({ transform: `translate(${px(spot.x)},${px(spot.y)}) ${ABOVE}`, offset: step / GLIDE_STEPS });
        }
        entry.glide = entry.node.animate(frames, { duration: left, easing: 'linear', fill: 'forwards' });
        entry.glide.onfinish = () => glide.done();
      });
      for (let index = current.length; index < nodes.length; index++) { const entry = nodes[index]!; if (!entry.node.hidden) entry.node.hidden = true; entry.shown = ''; }
    },
    /** The pin a click landed on, if any. */
    hit(target: EventTarget | null): PeoplePin | null {
      const key = (target as HTMLElement | null)?.closest?.<HTMLElement>('.m3-person')?.dataset.pin;
      return key ? current.find((pin) => pin.key === key) ?? null : null;
    },
    /** What is drawn, for tests and diagnostics. */
    shown: (): { key: string; kind: string; text: string; hidden: boolean; transform: string }[] => current.map((pin, index) => ({ key: pin.key, kind: pin.kind, text: pin.text, hidden: Boolean(nodes[index]!.node.hidden), transform: nodes[index]!.node.style.transform })),
    destroy(): void { for (const entry of nodes) { if (entry.glide) { entry.glide.onfinish = null; entry.glide.cancel(); } entry.node.remove(); } nodes.length = 0; current = []; },
  };
}
export type PinLayer = ReturnType<typeof createPinLayer>;
