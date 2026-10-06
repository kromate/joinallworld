/**
 * The head of the game's page for a short address (`/games`, `/games/oro`, `/abuja`, `/ogun`, …), written by both hosts: the
 * title, the description, the Open Graph and Twitter text, the canonical address and the robots line. The address table is
 * src/paths.ts and the places come from the city registry, so a city that is added has its preview with no change here.
 *
 * Only the head's text changes. The page's scripts are not touched, so the hashes the Content-Security-Policy admits (security-headers.ts
 * hashes the inline scripts of the page as it is served) are the same for every address. Every value is escaped. An address that
 * is not in the table (and an address that is only an action, like /signup) keeps the default head and is marked noindex.
 */
import { cityCatalogue } from '../src/game/cities/registry.ts';
import { GAME_SLUGS, knownStateIds, openCitiesOf, openCityIds, parsePath, pathOf, placeFacts } from '../src/paths.ts';
import type { GameSlug, PathIntent } from '../src/paths.ts';
import { SITE_ORIGIN } from './host-context.ts';

export interface PathMeta {
  title: string
  description: string
  /** The address the page says is its own (a path), or null to keep the default. */
  canonical: string | null
  /** An address worth showing in search. */
  index: boolean
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
};

/** What an intent's page says about itself. */
function metaOf(intent: PathIntent): PathMeta | null {
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
  }
}

/** The head for an address, or null for the home page (`/`), which keeps index.html's own head. An unknown address gets the default head with noindex. */
export function metaFor(pathname: string): PathMeta | null {
  if (pathname === '/' || pathname === '') return null;
  const intent = parsePath(pathname);
  return (intent ? metaOf(intent) : null) ?? { title: '', description: '', canonical: null, index: false };
}

const ESCAPES: Readonly<Record<string, string>> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);

/** Set the content of the one `<meta>` tag with this property or name. Nothing else in the page changes. */
const setMeta = (html: string, key: string, value: string): string =>
  html.replace(new RegExp(`(<meta (?:property|name)="${key}" content=")[^"]*(")`), (_all, open: string, close: string) => `${open}${escapeHtml(value)}${close}`);

/** index.html written for an address. `origin` is the page's public origin (no trailing slash); empty falls back to the site's own. */
export function withPathMeta(html: string, pathname: string, origin = ''): string {
  const meta = metaFor(pathname);
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
  return page;
}

/** The addresses worth listing in the sitemap, from the registry: the games, every open city, every state with several open cities. */
export function sitemapPaths(): string[] {
  const states = knownStateIds().filter((state) => openCitiesOf(state).length > 1);
  return ['/games', ...GAME_SLUGS.map((game) => `/games/${game}`), ...openCityIds().map((id) => `/${id}`), ...states.map((state) => `/${state}`)];
}
