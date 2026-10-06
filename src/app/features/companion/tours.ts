// The tours the companion leads. They are the walkthrough's own steps (tour/tourModel.ts, anchored on `data-tour`), so they use the same
// spotlight, waiting-for-the-player and skipping machinery; the companion's face and voice are on the card, and its 3D self points.
// "The basics" is the first-run tour. The others are short and offered at the right moment (director.ts), not all at the start.
import { STEPS } from '../tour/tourModel.ts'
import type { TourStep } from '../tour/tourModel.ts'
import type { TourId } from './types.ts'

export const TOUR_LABELS: Readonly<Record<TourId, { label: string; blurb: string }>> = {
  basics: { label: 'The basics', blurb: 'Needs, places, the Map and your phone' },
  travel: { label: 'Travel', blurb: 'Get to another city' },
  money: { label: 'Money and work', blurb: 'Jobs, Bank and missions' },
  friends: { label: 'Friends and calls', blurb: 'Find people, chat and call' },
  business: { label: 'Business', blurb: 'Run a stall of your own' },
}
export const TOUR_IDS = Object.keys(TOUR_LABELS) as TourId[]

const intro = (id: string, title: string, text: string): TourStep => ({ id, title, text })
const done = (text: string): TourStep => ({ id: 'done', title: 'That is it', text })

const TRAVEL: TourStep[] = [
  intro('travel-intro', 'Travel', 'Let me show you how to get around the world. It takes a minute.'),
  { id: 'travel-map', title: 'The Map', targets: ['nav-map'], doneTargets: ['map-card'], wait: 'map', text: 'Everything starts from the Map. Pick a place to see the trip first: how long it takes and what each way costs.', task: 'Tap Map to open it.', doneText: 'Pick any place and its trip card shows the time and fare for each way of going.' },
  { id: 'travel-world', title: 'Other cities', targets: ['map-world', 'nav-map'], keeps: 'map', text: 'Tap World at the top of the Map, then a city, then the bus, train or flight. Your home stays yours while you visit.' },
  done('Trips take real time, and some can be skipped for a fee. Ask me about "skip a trip" any time.'),
]
const MONEY: TourStep[] = [
  intro('money-intro', 'Money and work', 'Money first! Here is where it comes from and where it lives.'),
  { id: 'money-cash', title: 'Your cash', targets: ['hud'], prefer: 'bottom', text: 'Your cash is on the right of the top bar. Tap it to open your Bank.' },
  { id: 'money-phone', title: 'Your phone', targets: ['nav-phone'], doneTargets: ['phone-apps'], wait: 'phone', allows: 'phone', text: 'Work and money live in your phone.', task: 'Tap Phone to open it.', doneText: 'These are your apps.' },
  { id: 'money-jobs', title: 'Jobs', targets: ['app-jobs'], needs: ['app-jobs'], allows: 'phone', keeps: 'phone', text: 'Jobs pays you for every shift. Turn on Go automatically and the game walks you to work.' },
  { id: 'money-missions', title: 'Missions', targets: ['app-missions'], needs: ['app-missions'], allows: 'phone', keeps: 'phone', text: 'Missions are small daily and weekly goals. Finish one, tap to collect, and the cash is yours.' },
  { id: 'money-bank', title: 'Bank', targets: ['app-bank'], needs: ['app-bank'], allows: 'phone', keeps: 'phone', text: 'Bank keeps your money: rent, loans, savings and every naira in and out.' },
  done('Ask me "how do I earn money" whenever you want a push in the right direction.'),
]
const FRIENDS: TourStep[] = [
  intro('friends-intro', 'Friends and calls', 'People make Allworld. Let me show you how to find them.'),
  { id: 'friends-online', title: 'Who is here', targets: ['online'], needs: ['online'], prefer: 'bottom', text: 'The green count shows who is online. Tap it to see them, then tap a player to chat or call.' },
  { id: 'friends-phone', title: 'Your phone', targets: ['nav-phone'], doneTargets: ['phone-apps'], wait: 'phone', allows: 'phone', text: 'Your phone has People and Messages.', task: 'Tap Phone to open it.', doneText: 'These are your apps.' },
  { id: 'friends-people', title: 'People', targets: ['app-people'], needs: ['app-people'], allows: 'phone', keeps: 'phone', text: 'People finds players by name. Open a card to chat, call or send a gift. A call only rings: they choose whether to answer.' },
  { id: 'friends-messages', title: 'Messages', targets: ['app-messages'], needs: ['app-messages'], allows: 'phone', keeps: 'phone', text: 'Messages keeps your chats and groups. I live at the top of it too, if you ever want to talk.' },
  { id: 'friends-invite', title: 'Bring a friend', targets: ['invite'], needs: ['invite'], prefer: 'bottom', text: 'Invite makes your own link. A friend who joins through it starts as your friend.' },
  done('When a friend comes online I will tell you, so you can say hi.'),
]
const BUSINESS: TourStep[] = [
  intro('business-intro', 'Business', 'A stall of your own is the best way to grow. Here is how it works.'),
  { id: 'business-phone', title: 'Your phone', targets: ['nav-phone'], doneTargets: ['phone-apps'], wait: 'phone', allows: 'phone', text: 'Business is an app in your phone.', task: 'Tap Phone to open it.', doneText: 'These are your apps.' },
  { id: 'business-app', title: 'Business', targets: ['app-business'], needs: ['app-business'], allows: 'phone', keeps: 'phone', text: 'Open Business to rent a stall in a market, stock it and set your prices. Customers come while the market is open.' },
  { id: 'business-bank', title: 'Keep cash for rent', targets: ['app-bank'], needs: ['app-bank'], allows: 'phone', keeps: 'phone', text: 'A stall pays rent. Keep enough in your Bank, or the market closes it.' },
  done('I will warn you before the market closes or rent is due.'),
]

const BASICS: TourStep[] = STEPS.map((step) => ({ ...step }))

const BY_ID: Readonly<Record<TourId, readonly TourStep[]>> = { basics: BASICS, travel: TRAVEL, money: MONEY, friends: FRIENDS, business: BUSINESS }
export const tourSteps = (id: TourId): readonly TourStep[] => BY_ID[id]
export const isTourId = (value: unknown): value is TourId => typeof value === 'string' && Object.hasOwn(TOUR_LABELS, value)
