import type { CityLink, Block } from '../../types/content.ts'

/** New bookings only. Paid departures retain the existing completion/refund rules. */
export const routeUnavailable = (link: Pick<CityLink, 'status' | 'label'>): Block<'route_not_open'> | null =>
  link.status === 'coming' ? { code: 'route_not_open', reason: `${link.label} is coming soon. Choose an available route.` } : null
