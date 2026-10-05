/**
 * OWNER: world
 * The airport at Ikeja and the refinery in the Lekki Free Zone: two venues of the catalogue in
 * src/game/content/venues.ts (same shape — see the header there), kept in their own file.
 *
 * Provenance: everything here is an original beta value — names, hours, durations, prices,
 * effects, pay and cooldowns.
 *
 * The paid activities (`airport-carry-bags`, `refinery-load-drums`) are ordinary gigs: a need
 * cost, a cooldown and a place in the GIG_DAILY_LIMIT paid gigs a Lagos day allows.
 *
 * The airport's Travel desk does not sell tickets. Travel between cities is the country map's
 * business (systems/estate.ts 'estate.relocate', over the city link registry); the desk only reads the
 * flights that already exist there and says which cities they wait for.
 */
import { cityRules, linksFrom } from '../cities/registry.ts';
import type { VenueDefinition } from '../../types/content.ts';

const list = (names: string[]): string => (names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0] ?? '');
/** The desk reflects registered routes and current city status; tickets remain on the country map. */
const destinations = [...new Set(linksFrom('lagos').filter(link => link.mode === 'air').map(link => link.to))];
const names = (open: boolean) => destinations.filter(id => (cityRules(id)?.status === 'open') === open).map(id => cityRules(id)?.name ?? id);
const available = names(true), waiting = names(false);
const flightsLine = [available.length ? `Fly to ${list(available)} from the country map.` : '', waiting.length ? `Coming soon: ${list(waiting)}.` : ''].filter(Boolean).join(' ') || 'Flights leave from the country map';

export const AIRPORT: VenueDefinition = {
  id: 'airport', label: 'Airport', district: 'Ikeja', icon: '✈️', category: 'fun', beta: true,
  description: 'The terminal at Ikeja: check-in queues, a wall of glass on the runway and somebody’s whole family at Arrivals. Open all day and all night.',
  zone: 'mainland', map: { x: 7, y: 13 }, scene: { kind: 'airport' },
  ambient: ['A boarding call nobody can quite hear', 'A trolley with one bad wheel is winning', 'An aunty is re-packing a suitcase at the scale', 'The departures board just flipped a whole row'],
  spots: {
    departures: { id: 'departures', label: 'Departures hall', icon: '✈️', caption: 'Passport out, queue forming', activities: [
      { id: 'airport-planespot', label: 'Watch the Planes Board', icon: '✈️', duration: 9, cost: 0, effects: { fun: 8 }, tags: ['fun'], beta: true },
      { id: 'airport-peoplewatch', label: 'People-watch at Check-in', icon: '👀', duration: 8, cost: 0, effects: { social: 6, fun: 4 }, xp: { charisma: 8 }, tags: ['social'], beta: true },
    ] },
    arrivals: { id: 'arrivals', label: 'Arrivals', icon: '🚪', caption: 'Name boards and long hugs', activities: [
      { id: 'airport-welcome', label: 'Welcome a Traveller', icon: '👋', duration: 8, cost: 0, effects: { social: 12, fun: 4 }, xp: { charisma: 12 }, tags: ['social', 'training'], beta: true },
      { id: 'airport-carry-bags', label: 'Carry Bags to the Car Park', icon: '📦', duration: 13, reward: 300, minimumNeeds: { energy: 20 },
        effects: { energy: -10, hygiene: -4 }, xp: { hustle: 10, fitness: 6 }, cooldown: 300, tags: ['gig'], beta: true },
    ] },
    deck: { id: 'deck', label: 'Viewing deck', icon: '📷', caption: 'Glass from floor to ceiling', activities: [
      { id: 'airport-shoot-takeoff', label: 'Photograph a Take-off', icon: '📷', duration: 9, cost: 0, effects: { fun: 5 }, xp: { photography: 24 }, tags: ['training'], beta: true },
      { id: 'airport-runway-lights', label: 'Watch the Runway Lights', icon: '🌇', duration: 10, cost: 0, effects: { energy: 3, fun: 8 }, tags: ['rest'], beta: true },
    ] },
    lounge: { id: 'lounge', label: 'Food court', icon: '🍛', caption: 'Airport prices, airport portions', activities: [
      { id: 'airport-jollof', label: 'Jollof & Chicken Tray', icon: '🍛', duration: 8, cost: 2500, effects: { hunger: 45, fun: 4 }, tags: ['food'], beta: true },
      { id: 'airport-malt', label: 'Cold Malt', icon: '🥤', duration: 4, cost: 600, effects: { hunger: 6, fun: 5, bladder: -5 }, tags: ['drink'], beta: true },
      { id: 'airport-restroom', label: 'Use the Restroom', icon: '🚻', duration: 4, cost: 0, effects: { bladder: 60 }, tags: ['restroom'], beta: true },
    ] },
    desk: { id: 'desk', label: 'Travel desk', icon: '🧭', caption: flightsLine, activities: [
      { id: 'airport-flight-board', label: 'Read the Flight Board', icon: '🧭', duration: 5, cost: 0, effects: { fun: 3 }, tags: ['fun'], beta: true,
        note: 'Flavour only: no ticket is sold here. Flights between cities are the country map’s, and are refused there while the other city is not open.' },
      { id: 'airport-agent-gist', label: 'Ask the Agent About Routes', icon: '💬', duration: 7, cost: 0, effects: { social: 6 }, xp: { hustle: 8 }, tags: ['social', 'training'], beta: true },
    ] },
  },
};

export const REFINERY: VenueDefinition = {
  id: 'refinery', label: 'Refinery', district: 'Lekki Free Zone', icon: '🏭', category: 'work', beta: true,
  description: 'Tanks, columns and a flare you can see from the expressway. Sign in at the gate, keep your hard hat on.',
  hours: { open: 6, close: 22 },
  zone: 'east', map: { x: 96, y: 78 }, scene: { kind: 'refinery' },
  ambient: ['A tanker is reversing, very slowly', 'The flare is burning clean tonight', 'Somebody is counting hard hats at the gate', 'The canteen bell just went'],
  spots: {
    gate: { id: 'gate', label: 'Main gate', icon: '🚧', caption: 'Hard hat, boots, visitor tag', activities: [
      { id: 'refinery-induction', label: 'Sit the Safety Induction', icon: '🛡️', duration: 9, cost: 0, effects: { fun: 2 }, xp: { hustle: 6 }, tags: ['training'], beta: true },
      { id: 'refinery-gate-gist', label: 'Gist with the Gate Crew', icon: '💬', duration: 7, cost: 0, effects: { social: 10 }, xp: { charisma: 8 }, tags: ['social'], beta: true },
    ] },
    control: { id: 'control', label: 'Control room', icon: '🖥️', caption: 'A wall of dials and one red button', activities: [
      { id: 'refinery-shadow', label: 'Shadow a Control Operator', icon: '🖥️', duration: 12, cost: 0, effects: { energy: -4, fun: 2 }, xp: { coding: 26 }, tags: ['training'], beta: true },
      { id: 'refinery-process-class', label: 'Process Basics Class', icon: '📖', duration: 11, cost: 300, effects: { fun: 2 }, xp: { coding: 30 }, tags: ['training'], beta: true },
    ] },
    loading: { id: 'loading', label: 'Loading bay', icon: '📦', caption: 'Tankers queue from dawn', activities: [
      { id: 'refinery-load-drums', label: 'Load Drums onto a Truck', icon: '📦', duration: 15, reward: 450, minimumNeeds: { energy: 25 },
        effects: { energy: -14, hygiene: -8 }, xp: { fitness: 12, hustle: 6 }, cooldown: 300, tags: ['gig'], beta: true },
      { id: 'refinery-tally', label: 'Tally the Tankers', icon: '📋', duration: 9, cost: 0, effects: { fun: -2 }, xp: { hustle: 12 }, tags: ['training'], beta: true },
    ] },
    canteen: { id: 'canteen', label: 'Canteen', icon: '🍛', caption: 'Rice by the scoop, stew by the ladle', activities: [
      { id: 'refinery-rice', label: 'Canteen Rice & Beans', icon: '🍛', duration: 8, cost: 600, effects: { hunger: 40 }, tags: ['food'], beta: true },
      { id: 'refinery-water', label: 'Cold Sachet Water', icon: '💧', duration: 3, cost: 50, effects: { hunger: 2, energy: 3, bladder: -3 }, tags: ['drink'], beta: true },
      { id: 'refinery-restroom', label: 'Use the Restroom', icon: '🚻', duration: 4, cost: 0, effects: { bladder: 60 }, tags: ['restroom'], beta: true },
    ] },
    view: { id: 'view', label: 'Viewpoint', icon: '📷', caption: 'The flare lights up the whole shore', activities: [
      { id: 'refinery-shoot-flare', label: 'Photograph the Flare Stack', icon: '📷', duration: 9, cost: 0, effects: { fun: 5 }, xp: { photography: 24 }, tags: ['training'], beta: true },
      { id: 'refinery-tank-farm', label: 'Watch the Tank Farm at Work', icon: '🌇', duration: 10, cost: 0, effects: { energy: 3, fun: 6 }, tags: ['rest'], beta: true },
    ] },
  },
};
