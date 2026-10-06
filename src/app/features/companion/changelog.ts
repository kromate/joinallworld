// What is new, newest first: a short list the companion reads out. Add a line when something players will notice ships.
export interface ChangeEntry { id: string; text: string }
export const CHANGELOG: readonly ChangeEntry[] = [
  { id: 'companion', text: 'Meet your guide: tap it any time to ask what to do, find places, or take a tour.' },
  { id: 'cities', text: 'More Nigerian cities are open: travel from the Map, tap World and pick one.' },
  { id: 'calls', text: 'You can ring a friend from their card, and they choose whether to answer.' },
  { id: 'online', text: 'The top bar shows who is online now, and the invite button brings a friend in.' },
]
