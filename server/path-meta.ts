/**
 * The head of the game's page for a short address (`/games`, `/games/oro`, `/abuja`, `/ogun`, …), written by both hosts: the
 * title, the description, the Open Graph and Twitter text, the canonical address and the robots line. The address table is
 * src/paths.ts and the places come from the city registry, so a city that is added has its preview with no change here.
 *
 * Only the head's text changes. The page's scripts are not touched, so the hashes the Content-Security-Policy admits (security-headers.ts
 * hashes the inline scripts of the page as it is served) are the same for every address. Every value is escaped. An address that
 * is not in the table (and an address that is only an action, like /signup) keeps the default head and is marked noindex.
 */
import { cityCatalogue, loadCityRules } from '../src/game/cities/registry.ts';
import { GAME_SLUGS, knownStateIds, openCitiesOf, openCityIds, parsePath, pathOf, placeFacts, streetPlace } from '../src/paths.ts';
import type { GameSlug, PathIntent } from '../src/paths.ts';
import { SITE_ORIGIN } from './host-context.ts';
import { ENTRY_VARIANTS, placeWords, variantOf, withFigures, withPlace } from '../src/entry-variants.ts';
import { worldFigures } from '../src/app/features/start/entryModel.ts';
import { gameOfRoom } from '../src/arena/code.ts';
import { arenaGame } from '../src/arena/registry.ts';

export interface PathMeta {
  title: string
  description: string
  /** The address the page says is its own (a path), or null to keep the default. */
  canonical: string | null
  /** An address worth showing in search. */
  index: boolean
  /** The link-preview picture (a path on the site), or null to keep the default. */
  image?: string | null
}

const BRAND = 'Allworld';
const TAIL = 'Free in your browser, no download.';
/** The description of a page, kept to a length a search result shows. */
const clip = (text: string, max = 155): string => (text.length <= max ? text : `${text.slice(0, max - 1).replace(/\s+\S*$/, '')}…`);

const GAME_META: Readonly<Record<GameSlug, { title: string; description: string }>> = {
  chess: { title: `Play chess free — ${BRAND}`, description: `Play chess against the computer, easy, medium or hard. ${TAIL}` },
  oro: { title: `Oro, a new word every day — ${BRAND}`, description: `One word puzzle a day, the same for everyone. Guess it in six tries and share your squares. ${TAIL}` },
  weave: { title: `Play Weave, the word-tile game — ${BRAND}`, description: `Weave words across the cloth with seven tiles against the computer. ${TAIL}` },
  whot: { title: `Play Whot, the card game — ${BRAND}`, description: `Play Whot against the computer, or at a table with friends. ${TAIL}` },
  penalties: { title: `Play penalties, the shootout — ${BRAND}`, description: `Take the penalty shootout against the computer. ${TAIL}` },
  ayo: { title: `Play Ayo free — ${BRAND}`, description: `Sow and capture seeds in Ayo, played here with Oware rules, against the computer. ${TAIL}` },
};

/** What an intent's page says about itself (`now`: the server's time, for the words of a season such as Detty December). */
function metaOf(intent: PathIntent, now: number = Date.now()): PathMeta | null {
  switch (intent.kind) {
    case 'games':
      return intent.game
        ? { ...GAME_META[intent.game], canonical: pathOf(intent), index: true }
        : { title: `Play chess, the daily word and more — ${BRAND}`, description: `Chess, Oro (a new word every day), Weave, Whot and penalties. Play against the computer or at a table with friends. ${TAIL}`, canonical: '/games', index: true };
    case 'city': {
      const rules = placeFacts(intent.city);
      if (!rules) return null;
      if (intent.page === 'games') return { title: `Games in ${rules.name} — ${BRAND}`, description: clip(`Play chess, today’s word and more in ${rules.name}, with tables at its venues. ${TAIL}`), canonical: `/${rules.id}/games`, index: true };
      return { title: `Live in ${rules.name} — ${BRAND}`, description: clip(`${rules.teaser} Live there, work, travel and make friends. ${TAIL}`), canonical: `/${rules.id}`, index: true };
    }
    case 'state': {
      const known = cityCatalogue().filter((city) => city.state.id === intent.state);
      const name = known[0]?.state.name;
      if (!name) return null;
      const open = openCitiesOf(intent.state).map((id) => placeFacts(id)?.name ?? id);
      const description = open.length ? `Open now in ${name}: ${open.join(', ')}. ${TAIL}` : `${name} is coming to ${BRAND}. See what is open now. ${TAIL}`;
      return { title: `${name} — ${BRAND}`, description: clip(description), canonical: `/${intent.state}`, index: true };
    }
    case 'atlas': {
      const open = openCityIds().length;
      return intent.level === 'world'
        ? { title: `The map of the world — ${BRAND}`, description: clip(`A digital universe of the whole world: ${open} cities are open now, more are coming. ${TAIL}`), canonical: '/world', index: true }
        : { title: `Explore Nigeria — ${BRAND}`, description: clip(`The states and cities of Nigeria on one map: ${open} cities are open to live in. ${TAIL}`), canonical: '/nigeria', index: true };
    }
    case 'panel': return null;
    case 'street': {
      // A street (/street/<city>/<place>) or a visit (/visit/<city>): the row's own words with the names from the city's rules. A place the
      // rules do not have (or not loaded: preparePathMeta) is never written: the page is the city's visit, and its canonical says so.
      // A visit to Lagos, Accra or Abuja reads "Detty December in Lagos" from 1 to 31 December (WAT), by the date alone (placeWords).
      const facts = placeFacts(intent.city), found = streetPlace(intent.city, intent.place);
      const row = ENTRY_VARIANTS.find((variant) => variant.id === (found ? 'street' : 'visit'));
      const words = row ? placeWords(row, found ? null : intent.city, now) : undefined;
      if (!facts || !row || !words) return null;
      const place = { city: facts.name, name: found?.name ?? null };
      return { title: withPlace(words.title, place), description: clip(withPlace(words.description, place)), canonical: found ? `/street/${intent.city}/${found.id}` : `/visit/${intent.city}`, index: true, image: row.og };
    }
  }
}

/**
 * Before the head of a street is written: the city's rules, which name its local units and districts, are read (both hosts load them from
 * the city's content asset; once read they stay in memory). Never longer than `waitMs`, and never an error: without them the head is the
 * city's visit. Nothing to do for any other address.
 */
export async function preparePathMeta(pathname: string, waitMs = 1500): Promise<void> {
  const intent = /^\/street\//i.test(pathname) ? parsePath(pathname) : null;
  if (intent?.kind !== 'street' || !intent.place) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([loadCityRules(intent.city).catch(() => undefined), new Promise<void>((done) => { timer = setTimeout(done, waitMs); })]);
  if (timer !== undefined) clearTimeout(timer);
}

/** The head for an address, or null for the home page (`/`), which keeps index.html's own head. An unknown address gets the default head with noindex. `now` dates a season's words. */
export function metaFor(pathname: string, now: number = Date.now()): PathMeta | null {
  if (pathname === '/' || pathname === '') return null;
  // A street or a visit that names an open city: the row's words with the city's own names (metaOf). Fixed text and registry names only.
  const street = /^\/(street|visit)\//i.test(pathname) ? parsePath(pathname) : null;
  if (street?.kind === 'street') return metaOf(street, now);
  // An address of the entry page (src/entry-variants.ts): its own words and its own picture, the same on both hosts. Fixed text: nothing a visitor typed.
  const variant = variantOf(pathname);
  if (variant && variant.id !== 'home') {
    const figures = worldFigures(cityCatalogue());
    return { title: variant.title, description: clip(withFigures(variant.description, figures)), canonical: variant.paths[0] ?? null, index: true, image: variant.og };
  }
  // The Square's address and a group room's link (docs/PLACES.md). Fixed words: a room's name is its members' and is never put in a preview.
  if (pathname === '/square' || pathname === '/square/') return { title: `The Square — one place for the whole world — ${BRAND}`, description: clip(`Meet people from every city in one square: walk up, chat and talk by voice. ${TAIL}`), canonical: '/square', index: true };
  if (/^\/w\/[^/]+\/?$/.test(pathname)) return { title: `Come into my world on ${BRAND}`, description: clip(`A friend made a world of their own and sent you its link: walk in, look round, play. Pick a name and press Play, no sign-up. ${TAIL}`), canonical: null, index: false };
  if (/^\/r\/[^/]+\/?$/.test(pathname)) return { title: `Come to our room on ${BRAND}`, description: clip(`A friend invited you into their group's room: come in and talk. Pick a name and press Play, no sign-up. ${TAIL}`), canonical: null, index: false };
  const intent = parsePath(pathname);
  return (intent ? metaOf(intent) : null) ?? { title: '', description: '', canonical: null, index: false };
}

const ESCAPES: Readonly<Record<string, string>> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);

/** Set the content of the one `<meta>` tag with this property or name. Nothing else in the page changes. */
const setMeta = (html: string, key: string, value: string): string =>
  html.replace(new RegExp(`(<meta (?:property|name)="${key}" content=")[^"]*(")`), (_all, open: string, close: string) => `${open}${escapeHtml(value)}${close}`);

/**
 * The head of an invite link to a live game (`/?table=g-fight-k7m2qp`): it names the game. Only the game's own label is used (from the
 * registry, never from the link), the link is not for search engines, and the page keeps its default picture and canonical address.
 */
export function roomMeta(pathname: string, search: string): PathMeta | null {
  if (pathname !== '/' && pathname !== '') return null;
  const code = /[?&]table=([a-z0-9-]{1,40})(?:[&#]|$)/.exec(search)?.[1];
  // A clan invite (src/app/features/games/clansModel.ts): the preview names no clan (the page is not read from the store), only what it is.
  if (code && /^clan-[a-hjkmnp-z]{6}$/.test(code)) return { title: `Join my clan on ${BRAND}`, description: `Play Fight, Race and Football with your clan and climb your city's ladder. ${TAIL}`, canonical: null, index: false };
  const game = code ? arenaGame(gameOfRoom(code)) : null;
  if (!game) return null;
  return { title: `Join my ${game.label} match on ${BRAND}`, description: `A friend is waiting for you in a live ${game.label} match. Tap to play, or to watch if it is full. ${TAIL}`, canonical: null, index: false };
}

/** index.html written for an address. `origin` is the page's public origin (no trailing slash); empty falls back to the site's own. `now` dates a season's words. */
export function withPathMeta(html: string, pathname: string, origin = '', search = '', now: number = Date.now()): string {
  const meta = roomMeta(pathname, search) ?? metaFor(pathname, now);
  if (!meta) return html;
  let page = html;
  if (!meta.index) page = setMeta(page, 'robots', 'noindex,follow');
  if (meta.title) {
    page = page.replace(/<title>[^<]*<\/title>/, () => `<title>${escapeHtml(meta.title)}</title>`);
    for (const key of ['og:title', 'twitter:title']) page = setMeta(page, key, meta.title);
    for (const key of ['description', 'og:description', 'twitter:description']) page = setMeta(page, key, meta.description);
  }
  if (meta.canonical) {
    const url = `${origin || SITE_ORIGIN}${meta.canonical}`;
    page = page.replace(/(<link rel="canonical" href=")[^"]*(")/, (_all, open: string, close: string) => `${open}${escapeHtml(url)}${close}`);
    page = setMeta(page, 'og:url', url);
  }
  if (meta.image) {
    const picture = `${origin || SITE_ORIGIN}${meta.image}`;
    for (const key of ['og:image', 'twitter:image']) page = setMeta(page, key, picture);
    for (const key of ['og:image:alt', 'twitter:image:alt']) page = setMeta(page, key, meta.title);
  }
  return page;
}

/** The addresses worth listing in the sitemap, from the registry: the games, every open city, every state with several open cities, and the guides (server/docs-pages.ts). */
export function sitemapPaths(): string[] {
  const states = knownStateIds().filter((state) => openCitiesOf(state).length > 1);
  return ['/games', ...ENTRY_VARIANTS.flatMap((variant) => (variant.id === 'home' || variant.id === 'games' ? [] : [variant.paths[0] ?? ''])), ...GAME_SLUGS.map((game) => `/games/${game}`), ...openCityIds().map((id) => `/${id}`), ...states.map((state) => `/${state}`), '/about', '/features', '/pages', '/skills'];
}
