import { NIGERIA } from '../country.ts'
import { CAREER_IDS } from '../../content/career-ids.ts'

/** Compact eager metadata shared by every open Ogun city. No prose or lazy catalogue imports. */
export const OGUN_RULES_BASE = Object.freeze({
  status: 'open' as const,
  unit: 'local government',
  seaPlots: false,
  hasStateOverview: true,
  state: Object.freeze({ id: 'ogun' as const, name: 'Ogun State', unit: 'local government' }),
  country: NIGERIA,
  timezone: 'Africa/Lagos',
  defaultName: 'New arrival',
  careerIds: CAREER_IDS,
})
