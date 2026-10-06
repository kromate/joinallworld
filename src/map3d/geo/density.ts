/**
 * OWNER: world
 * How much the maps write on themselves, as one small table to tune. A phone gets smaller type and fewer names, and a larger
 * text setting (the root font size above 16px) drops names to dots rather than letting them pile up. Pure — no DOM.
 */
export interface Density {
  /** Type size in px of an open city's name, the player's own city, and of everything else the atlas names. */
  city: number; other: number;
  /** Most city names shown at once on the atlas; the rest are dots (the player's city is always named). */
  atlasNames: number;
  /** Most venue names shown at once on the city map; the rest are round icons (the selected, current and goal venues are always named). */
  venueNames: number;
  /** Longest venue name drawn before it is cut with an ellipsis, in characters. */
  venueChars: number;
}
export const DENSITY = {
  phone: { city: 12, other: 10, atlasNames: 6, venueNames: 5, venueChars: 16 },
  wide: { city: 13, other: 11, atlasNames: 14, venueNames: 14, venueChars: 24 },
} as const satisfies Record<string, Density>;
/** The width, in CSS px, up to which the phone row of the table applies. */
export const PHONE_WIDTH = 520;

/** The row for a screen `width` px wide and a text scale (1 is the browser default). */
export function densityFor(width: number, textScale = 1): Density {
  const row: Density = width <= PHONE_WIDTH ? DENSITY.phone : DENSITY.wide, less = textScale > 1.1 ? 1 / textScale : 1;
  return { ...row, atlasNames: Math.max(2, Math.floor(row.atlasNames * less)), venueNames: Math.max(2, Math.floor(row.venueNames * less)) };
}

/** A venue's name cut to `chars` characters with an ellipsis (the whole name stays in the tooltip and the aria label). */
export const shorten = (name: string, chars: number): string => (name.length <= chars ? name : `${name.slice(0, Math.max(1, chars - 1)).trimEnd()}…`);

/**
 * How many venue names the city map writes in full at this zoom: the table's count when the view is as far out as the opening view,
 * more as the camera comes closer (up to three times as many), a few fewer when it is further out. `ratio` is the opening distance over the camera's.
 */
export const venueNamesAt = (row: Density, ratio: number): number => Math.max(2, Math.round(row.venueNames * Math.min(3, Math.max(0.6, ratio))));
/** A name is always written for the places that matter to the player: priority at or above this (here, picked, on the way, under the pointer, Home). */
export const NAMED_FROM = 60;

/** How many city names the atlas writes at this zoom: the table's count at the whole-level view, up to three times as many nearer, a few fewer if further out. `ratio` is the whole-level distance over the camera's. */
export const atlasNamesAt = (row: Density, ratio: number): number => Math.max(2, Math.round(row.atlasNames * Math.min(3, Math.max(0.6, ratio))));

/**
 * Which of the city markers keep a name: the ones that are always shown (the player's city), then the most important, up to `budget`; the rest are dots.
 * Ties go to the earlier id so the choice does not flicker as the view moves.
 */
export function namedCities<T extends { id: string; priority: number; fixed?: boolean | undefined }>(cities: readonly T[], budget: number): Set<string> {
  const keep = new Set(cities.filter((city) => city.fixed).map((city) => city.id));
  for (const city of [...cities].sort((a, b) => b.priority - a.priority || (a.id < b.id ? -1 : 1))) { if (keep.size >= budget) break; keep.add(city.id); }
  return keep;
}

/** A count chip ("Ogun · 4") for each group that lost at least `least` names to dots: group → how many. */
export function countChips(dropped: readonly string[], least = 3): [string, number][] {
  const counts = new Map<string, number>();
  for (const group of dropped) counts.set(group, (counts.get(group) ?? 0) + 1);
  return [...counts].filter(([, count]) => count >= least).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
}
