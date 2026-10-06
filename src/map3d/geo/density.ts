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
