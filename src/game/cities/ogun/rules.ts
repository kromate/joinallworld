export const OGUN_CAREER_IDS = Object.freeze([
  'community-helper', 'tech', 'banking', 'music', 'trading', 'nursing', 'hair', 'chef', 'dj',
  'fitness', 'creator', 'teaching', 'event', 'football', 'retail',
])

/** Compact eager metadata shared by every open Ogun city. No prose or lazy catalogue imports. */
export const OGUN_RULES_BASE = Object.freeze({
  status: 'open' as const,
  unit: 'local government',
  seaPlots: false,
  hasStateOverview: true,
  state: Object.freeze({ id: 'ogun' as const, name: 'Ogun State', unit: 'local government' }),
  country: Object.freeze({ id: 'ng', name: 'Nigeria' }),
  timezone: 'Africa/Lagos',
  defaultName: 'New arrival',
  careerIds: OGUN_CAREER_IDS,
})
