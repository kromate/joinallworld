import { cachedCityContent, cityRules } from '../cities/registry.ts';
/** Shared venue categories, scene kinds, gig limits and city-aware display helpers. */
import type { HouseId } from '../../types/life.ts';
import type {
  ComingSoonDefinition, SceneKind, VenueCategory, VenueCategoryId,
} from '../../types/content.ts';

/**
 * Paid gigs a player may finish per Lagos day, over all venues together (original beta value).
 * A gig is any venue activity that pays — a `reward`, or a chance of one — and is not a job's
 * shift. scripts/economy-sim.ts showed why it is needed: on cooldowns alone, touring every gig
 * all day earned about ₦1,000,000 a day against ₦3,600 for a first career shift. With eight, an
 * unskilled player's gigs come to roughly one entry-level shift for several times the effort,
 * and a skilled player's to roughly one mid-career shift: a useful second income, never the only
 * sensible one. A career shift and the Community helper shift do not count towards it.
 */
export const GIG_DAILY_LIMIT = 8;


export const SCENE_KINDS: readonly SceneKind[] = Object.freeze(['park', 'buka', 'hub', 'club', 'office', 'market', 'gym', 'mall', 'beach', 'hospital', 'salon', 'rooftop',
  'police', 'worship', 'radio', 'polling', 'viewing', 'shrine', 'walk', 'statehouse', 'airport', 'refinery', 'unilag', 'home',
  'quad', 'hilltop', 'lakeside']);

/** Map filter bar. */
export const VENUE_CATEGORIES: Record<VenueCategoryId, VenueCategory> = {
  food: { id: 'food', label: 'Food' },
  fun: { id: 'fun', label: 'Fun & culture' },
  nightlife: { id: 'nightlife', label: 'Nightlife' },
  work: { id: 'work', label: 'Work & skills' },
  care: { id: 'care', label: 'Care & faith' },
  civic: { id: 'civic', label: 'Civic' },
};


/**
 * Shown on the map but not enterable yet: { [id]: { id, label, district, icon, description, zone, map: { x, y } } }.
 * No place in Lagos is waiting now — the airport and the refinery are venues — but the mechanism
 * stays for the next one: the travel rules refuse it ('coming_soon') and both maps mark it.
 */
export const COMING_SOON: Record<string, ComingSoonDefinition> = {};

/** Legacy balanced rental id; each city's module supplies its own home positions. */
export const DEFAULT_HOME: HouseId = 'yaba';
/** Old saved references use the same authored aliases as life migration. */
const displayVenue = (venueId: string, cityId: string) => {
  const venues = cachedCityContent(cityId)?.venues;
  return venues?.find(item => item.id === venueId) ?? venues?.find(item => item.id === cityRules(cityId)?.legacyVenueAliases?.[venueId]);
};
export const venueLabel = (venueId: string, cityId: string): string => displayVenue(venueId, cityId)?.name ?? COMING_SOON[venueId]?.label ?? venueId;
export const venueDistrict = (venueId: string, cityId: string): string => displayVenue(venueId, cityId)?.district ?? COMING_SOON[venueId]?.district ?? '';
