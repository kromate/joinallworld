// Home for a visitor, without a DOM: the words of the Home tab's sheet for a life in a city where it has no home, and
// what each of its buttons says. Everything comes from view.estate (src/game/systems/estate.ts): where the main home
// is, what a room costs and why it cannot be taken now, what a home here costs, and whether the main home may move.
import type { EstateView } from '../../../types/view.ts'
import { money } from '../../ui/format.ts'

type Estate = Pick<EstateView, 'cityName' | 'home' | 'visiting' | 'lodging' | 'settle'>
export interface VisitorHome {
  title: string
  line: string
  /** "Rest at a guest house · ₦2,500", and why it is off (already rested, not enough cash, busy, not connected). */
  rest: { label: string; why: string }
  /** "Travel home to Lagos": absent for a life with no home anywhere. */
  home: { label: string } | null
  /** An additional home here: the house and the lowest price. */
  buy: { label: string; note: string }
  /** The main home moved here: what it gives up, or why it cannot. */
  main: { label: string; note: string; why: string }
}

/** The sheet's words, or null for a life that is not visiting (it has a home here, or has not settled in). */
export function visitorHome(estate: Estate, offline = ''): VisitorHome | null {
  if (!estate.visiting || !estate.settle) return null
  const home = estate.home?.name ?? null, { buy, main } = estate.settle
  return {
    title: `You are visiting ${estate.cityName}`,
    line: home ? `Your home is in ${home}. Everything is open to you here: work, eat, shop, meet people.` : 'Everything is open to you here: work, eat, shop, meet people.',
    rest: { label: `Rest at a guest house · ${money(estate.lodging.fee)}`, why: offline || estate.lodging.blocked || '' },
    home: home ? { label: `Travel home to ${home}` } : null,
    buy: { label: `Buy a home here · from ${money(buy.from)}`, note: `A ${buy.tier.toLowerCase()} on a plot you choose, yours as well as your home in ${home ?? 'your first city'}: rest there free and be a resident here too.${buy.groundRent ? ` Ground rent ${money(buy.groundRent)} a week while you are here.` : ''}` },
    main: { label: `Make ${estate.cityName} my main home`, why: offline || main.blocked || '', note: `Free: your starter house stands on a plot here instead, and you give up ${main.gives ?? 'the home you leave'}. You vote where your main home is.` },
  }
}
