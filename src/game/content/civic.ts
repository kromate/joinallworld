/**
 * OWNER: civic
 * Civic content — election rules, billboard slots, sea plots, the daily gem hunt, club radio,
 * home districts and the rich list. Plain data only (no functions, no imports).
 *
 * Provenance: `beta: true` marks a provisional value that may be retuned. Only the fields listed
 * in an entry's `observed` array are fixed; everything about HOW these features work (cycles,
 * eligibility, caps, queues, clues) is provisional design.
 */

/** Weekly election cycle on Lagos time. Weekdays: 0 = Sunday … 6 = Saturday. Original beta rules. */
import type { AdColour, AdIcon, BillboardContent, District, ElectionRules, HuntContent, RadioContent, SeaPlotContent } from '../../types/content.ts'

export const ELECTION: ElectionRules = {
  beta: true,
  nominationWeekdays: [1, 2, 3], // Monday–Wednesday: candidates declare
  votingWeekdays: [4, 5, 6], // Thursday–Saturday: one vote per player
  resultsWeekday: 0, // Sunday: polls are closed, the winner takes office for seven days
  termDays: 7,
  minDaysToRun: 2, // Lagos calendar days lived in the city
  minDaysToVote: 1,
  minWorkDays: 2, // different days with paid work (a shift or a gig) before voting or running — original beta value
  filingFee: 2000, // in-game naira, not refunded
  sloganMin: 3,
  sloganMax: 60,
  maxCandidates: 30,
  keepElections: 8, // weeks of history kept in storage
  pollingVenue: 'polling-unit', // voting happens here once the venue exists
  stateHouseVenue: 'state-house',
  announcement: { max: 140, min: 3, cooldownMs: 3600000, perDay: 3, keep: 20 },
};

/** Text on the State House sheet (Lagos). */
export const STATE_HOUSE_TEXT = {
  title: 'Lagos State House',
  empty: 'Lagos has no Governor yet. Sign up to vote, or run for office yourself.',
};

/** Fixed creative choices for billboards and sea plots: no uploads and no links in this wave. */
export const AD_COLOURS: AdColour[] = [
  { id: 'green', label: 'Green', bg: '#256b45', ink: '#ffffff' },
  { id: 'gold', label: 'Gold', bg: '#e8a643', ink: '#20232c' },
  { id: 'red', label: 'Red', bg: '#b23a2e', ink: '#ffffff' },
  { id: 'blue', label: 'Blue', bg: '#2b5fa8', ink: '#ffffff' },
  { id: 'purple', label: 'Purple', bg: '#6a3fa0', ink: '#ffffff' },
  { id: 'teal', label: 'Teal', bg: '#1f8a86', ink: '#ffffff' },
  { id: 'night', label: 'Night', bg: '#182a25', ink: '#ffffff' },
  { id: 'white', label: 'White', bg: '#ffffff', ink: '#20232c' },
];

export const AD_ICONS: AdIcon[] = [
  { id: 'star', icon: '⭐' }, { id: 'shop', icon: '🛍️' }, { id: 'food', icon: '🍲' }, { id: 'music', icon: '🎵' },
  { id: 'phone', icon: '📱' }, { id: 'car', icon: '🚗' }, { id: 'house', icon: '🏠' }, { id: 'heart', icon: '❤️' },
  { id: 'crown', icon: '👑' }, { id: 'fire', icon: '🔥' }, { id: 'ball', icon: '⚽' }, { id: 'book', icon: '📚' },
  { id: 'scissors', icon: '✂️' }, { id: 'camera', icon: '📷' }, { id: 'palm', icon: '🌴' }, { id: 'megaphone', icon: '📣' },
];

export const AD_TEXT = { min: 2, max: 40 };

/**
 * Roadside billboard slots. `near` is a venue id so a map can anchor the board beside that
 * venue; `road` is the Lagos display name. Slots, price and period are original beta values.
 */
export const BILLBOARDS: BillboardContent = {
  beta: true,
  price: 1500,
  days: 7,
  maxPerPlayer: 2,
  slots: [
    { id: 'bb-01', near: 'radio', road: 'Ikorodu Road' },
    { id: 'bb-02', near: 'shrine', road: 'Agidingbi Road' },
    { id: 'bb-03', near: 'viewing-centre', road: 'Western Avenue' },
    { id: 'bb-04', near: 'amala-shitta', road: 'Shitta Roundabout' },
    { id: 'bb-05', near: 'cchub', road: 'Herbert Macaulay Way' },
    { id: 'bb-06', near: 'hospital', road: 'Third Mainland approach' },
    { id: 'bb-07', near: 'market', road: 'Broad Street' },
    { id: 'bb-08', near: 'park', road: 'Marina' },
    { id: 'bb-09', near: 'office', road: 'Awolowo Road' },
    { id: 'bb-10', near: 'library', road: 'Adeola Odeku Street' },
    { id: 'bb-11', near: 'quilox', road: 'Ozumba Mbadiwe Avenue' },
    { id: 'bb-12', near: 'palms', road: 'Lekki–Epe Expressway' },
  ],
};

/**
 * Sea plots: a grid of floating tiles. Plot ids are `sea-<row>-<col>`, both zero-based; row 0
 * is nearest the shore. Plots are "from ₦100 a plot" and float
 * "for 30 days". Grid size, the dearer shore rows and the per-player cap are original beta values.
 */
export const SEA_PLOTS: SeaPlotContent = {
  observed: ['price', 'days'],
  price: 100,
  days: 30,
  cols: 16, // original beta value
  rows: 16, // original beta value
  shoreRows: 2, // original beta value
  shorePrice: 250, // original beta value
  maxPerPlayer: 12, // original beta value
};

/**
 * Daily gem hunt. A HUD chip reads "Daily gem hunt · N found ·
 * next prize ₦3,000". Gems per day, where they hide, how they are found and the once-a-day
 * claim are original beta design.
 */
export const HUNT: HuntContent = {
  observed: ['prize', 'label'],
  label: 'Daily gem hunt',
  prize: 3000,
  gemsPerDay: 3, // original beta value
};

/** Club radio shout-outs: title and artist text only — no audio and no links. Original beta values. */
export const RADIO: RadioContent = {
  beta: true,
  venues: ['quilox', 'library', 'shrine', 'rooftop'],
  price: 500,
  slotSeconds: 60,
  perPlayerPerDay: 3,
  queueMax: 20,
  titleMax: 40,
  artistMax: 40,
  label: 'Club radio', // chip label
  cta: 'Play your song here', // button label
};

/** Home districts, keyed by house id (the home owner stores which one a player lives in). Names as shown to players. */
export const DISTRICTS: District[] = [
  { id: 'mushin', label: 'Mushin' },
  { id: 'yaba', label: 'Yaba' },
  { id: 'lekki', label: 'Lekki Phase 1' },
  { id: 'ikoyi', label: 'Ikoyi' },
  { id: 'banana', label: 'Banana Island' },
];
export const UNKNOWN_DISTRICT: District = { id: 'unknown', label: 'District not set yet' };
/** A resident who lives in their own house on a plot (the house everyone is given: systems/estate.ts) rents in no district. Original beta label. */
export const OWN_DISTRICT: District = { id: 'own', label: 'In their own house' };

/** What the people of each city are called in counters; other cities fall back to "<City> residents". */
export const DEMONYMS: Record<string, string> = { lagos: 'Lagosians' };

export const NEIGHBOURS = { beta: true, perDistrict: 60, total: 200 };
export const RICH_LIST = { beta: true, size: 20 };

/** Kept for older imports of the placeholder export. */
export const CIVIC = { ELECTION, BILLBOARDS, SEA_PLOTS, HUNT, RADIO };
