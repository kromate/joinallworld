/**
 * Where a link in an e-mail may open the game: `/?go=<target>`. A fixed list, shared by the server (which builds the
 * links) and the browser (which opens the panel), so a link can only ever open one of these panels and nothing else.
 */
export const GO_TARGETS = Object.freeze({
  needs: 'needs',
  messages: 'messages',
  people: 'people',
  career: 'career',
  houses: 'houses',
  events: 'events',
  governor: 'governor',
  tables: 'tables',
  bank: 'bank',
  touch: 'touch',
} as const);
export type GoTarget = keyof typeof GO_TARGETS;

/** The target a search string asks for, or null (anything not on the list, however it is written). */
export function goFrom(search: unknown): GoTarget | null {
  const found = /[?&]go=([a-z]{3,12})(?:[&#]|$)/.exec(String(search ?? ''));
  const name = found?.[1];
  return name !== undefined && Object.hasOwn(GO_TARGETS, name) ? (name as GoTarget) : null;
}

/** The address a mail's button opens. */
export const goUrl = (origin: string, target: GoTarget): string => `${origin}/?go=${target}`;
