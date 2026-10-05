import { cachedCityContent } from '../cities/registry.ts';
/** Shared venue categories, scene kinds, gig limits and city-aware display helpers. */
import type { HouseId, VenueId, WorldCityId } from '../../types/life.ts';
import type {
  CityVenueLabel, ComingSoonDefinition, SceneKind, VenueCategory, VenueCategoryId,
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
/** Labels for unrecognised ids in the old Ibadan preview. Loaded module definitions win. */
export const CITY_LABELS: Partial<Record<WorldCityId, Partial<Record<VenueId, CityVenueLabel>>>> = {
  ibadan: {
    park: { label: 'Agodi Gardens', district: 'Agodi' },
    library: { label: 'City Reading Room', district: 'Bodija' },
    radio: { label: 'Oluyole Radio', district: 'Mokola' },
    shrine: { label: 'Mokola Music Yard', district: 'Mokola' },
    'viewing-centre': { label: 'Viewing Centre', district: 'Sango' },
    'amala-shitta': { label: 'Bodija Amala Joint', district: 'Bodija' },
    cchub: { label: 'Tech Hub', district: 'Agbowo' },
    hospital: { label: 'Teaching Hospital', district: 'Oritamefa' },
    salon: { label: 'Iya Ibeji’s Salon', district: 'Iwo Road' },
    church: { label: 'Church', district: 'Oke Ado' },
    mosque: { label: 'Mosque', district: 'Oja’ba' },
    market: { label: 'Dugbe Market', district: 'Dugbe' },
    police: { label: 'Police Station', district: 'Iyaganku' },
    'polling-unit': { label: 'Polling Unit', district: 'Mapo' },
    'state-house': { label: 'Oyo State House', district: 'Agodi' },
    'i-fitness': { label: 'Ring Road Gym', district: 'Ring Road' },
    office: { label: 'Cocoa House', district: 'Dugbe' },
    quilox: { label: 'Seven Hills Club', district: 'Jericho' },
    rooftop: { label: 'Premier Hill Rooftop', district: 'Mokola Hill' },
    'canopy-walk': { label: 'Forest Reserve Walk', district: 'Akobo' },
    palms: { label: 'Ring Road Mall', district: 'Ring Road' },
    beach: { label: 'Eleyele Lakeside', district: 'Eleyele' },
    airport: { label: 'Airport', district: 'Alakia' },
    refinery: { label: 'Dry Port', district: 'Moniya' },
  },
};

// The same tables read by an arbitrary (possibly unknown) id, as the callers do.
const cityLabelsById: Record<string, Record<string, CityVenueLabel | undefined> | undefined> = CITY_LABELS;
export const venueLabel = (venueId: string, cityId: string): string => cachedCityContent(cityId)?.venues.find(item => item.id === venueId)?.name ?? cityLabelsById[cityId]?.[venueId]?.label ?? COMING_SOON[venueId]?.label ?? venueId;
export const venueDistrict = (venueId: string, cityId: string): string => cachedCityContent(cityId)?.venues.find(item => item.id === venueId)?.district ?? cityLabelsById[cityId]?.[venueId]?.district ?? COMING_SOON[venueId]?.district ?? '';
