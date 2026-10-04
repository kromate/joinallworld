/**
 * OWNER: world
 * Roadside events offered on arrival, and chance outcomes of a few venue activities.
 * Everything is picked and resolved with ctx.rng (systems/travel.js), so a replayed request
 * gives the same result.
 *
 * EVENTS[id] = {
 *   id, icon, title, text,
 *   modes: [modeId, ...],          // trips on these modes can trigger it
 *   weight,                        // relative chance among the events that fit the trip
 *   choices: [choice, ...],        // the LAST choice is always free and has no requirement
 * }
 * choice = {
 *   id, label, hint,
 *   cost?,                         // naira; the choice is refused (and stays open) if unaffordable
 *   effects?, xp?, reward?, moodlet?, treat?,   // applied when chosen ("treat" cures illness)
 *   result,                        // message shown afterwards
 *   check?: { skill, base, perLevel, max, success: {...same fields}, failure: {...same fields} },
 * }
 *
 * Provenance: the agbo seller (title, the ₦600 price, the two choices, appearing after a trek)
 * was observed in the reference game. Every other event, every effect amount and every
 * probability is an original beta value. Money effects are small and bounded: no choice pays
 * more than ₦500, an event needs a trip (which costs time, and usually a fare) to appear, and an
 * event marked `oncePerDay` is offered at most once per Lagos day.
 */
export const EVENTS = {
  agbo: {
    id: 'agbo', icon: '🌿', title: 'Iya Agbo by the road', modes: ['trek'], weight: 5,
    text: 'A woman with a tray of dark bottles waves you over. “This one will clear anything in your body.”',
    choices: [
      { id: 'buy', label: 'Buy agbo', hint: 'Bitter, but it works', cost: 600, treat: true, effects: { energy: 5 }, beta: true,
        result: 'You drank the agbo in one go. Bitter — but your body thanks you.' },
      { id: 'decline', label: 'No, thank you ma', hint: 'Keep walking', result: 'You thanked her and kept walking.' },
    ],
  },
  hawker: {
    id: 'hawker', icon: '🥤', title: 'Hawker in the go-slow', modes: ['danfo', 'keke', 'cab', 'car'], weight: 3, beta: true,
    text: 'Traffic has stopped and a hawker is jogging beside your window with sausage rolls and cold drinks.',
    choices: [
      { id: 'buy', label: 'Buy a roll and a drink', hint: 'Lunch through the window', cost: 300, effects: { hunger: 15, fun: 3 }, result: 'Cold drink, warm roll. The go-slow is almost bearable.' },
      { id: 'decline', label: 'Not today', hint: 'Wind up', result: 'You waved the hawker on.' },
    ],
  },
  change: {
    id: 'change', icon: '🪙', title: '“I no get change”', modes: ['danfo'], weight: 3, beta: true,
    text: 'The conductor is holding your balance and suddenly cannot find ₦50.',
    choices: [
      { id: 'insist', label: 'Insist on your change', hint: 'Charisma decides', result: '',
        check: { skill: 'charisma', base: 0.45, perLevel: 0.07, max: 0.95,
          success: { reward: 50, xp: { charisma: 10 }, result: 'The whole bus backed you. The conductor produced ₦50.' },
          failure: { effects: { fun: -3 }, xp: { charisma: 4 }, result: 'He drove off with your ₦50. Lagos.' } } },
      { id: 'leave', label: 'Leave it', hint: 'Not worth the stress', effects: { fun: -1 }, result: 'You let the ₦50 go.' },
    ],
  },
  puddle: {
    id: 'puddle', icon: '💦', title: 'Bus versus puddle', modes: ['trek', 'okada'], weight: 2, beta: true,
    text: 'A bus is speeding toward a very large puddle right beside you.',
    choices: [
      { id: 'jump', label: 'Jump clear', hint: 'Fitness decides', result: '',
        check: { skill: 'fitness', base: 0.5, perLevel: 0.08, max: 0.95,
          success: { xp: { fitness: 10 }, effects: { fun: 3 }, result: 'You leapt like a gazelle. Dry as a bone.' },
          failure: { effects: { hygiene: -8 }, xp: { fitness: 4 }, result: 'Splash. Your trousers are now a different colour.' } } },
      { id: 'shield', label: 'Turn your back and brace', hint: 'Take a small splash', effects: { hygiene: -3 }, result: 'Only your back got wet.' },
    ],
  },
  wallet: {
    // oncePerDay: the only event that can pay real money appears at most once per Lagos day, so
    // walking up and down a road is not a way to earn (original beta rule; systems/travel.js).
    id: 'wallet', icon: '👛', title: 'A wallet on the ground', modes: ['trek', 'keke'], weight: 2, beta: true, oncePerDay: true,
    text: 'Somebody has dropped a wallet by the roadside. There is an ID card inside, and a little cash.',
    choices: [
      { id: 'return', label: 'Hand it in at the nearest shop', hint: 'Do the right thing', effects: { social: 5 },
        moodlet: { id: 'good-deed', label: 'Good Deed', value: 6, duration: 1200 }, result: 'The shopkeeper knows the owner. You feel taller.' },
      { id: 'pocket', label: 'Pocket the cash', hint: '₦500, and a conscience', reward: 500,
        moodlet: { id: 'guilty', label: 'Guilty Conscience', value: -6, duration: 1200 }, result: '₦500 richer, and not proud of it.' },
      { id: 'ignore', label: 'Keep walking', hint: 'Not your business', result: 'You left the wallet where it was.' },
    ],
  },
  toll: {
    id: 'toll', icon: '🧢', title: '“Something for the boys”', modes: ['trek', 'okada', 'keke'], weight: 2, beta: true,
    text: 'Three young men are blocking the shortcut, asking every passer-by for a little something.',
    choices: [
      { id: 'pay', label: 'Give them ₦200', hint: 'Buy peace', cost: 200, result: 'They hailed you loudly and waved you through.' },
      { id: 'talk', label: 'Talk your way through', hint: 'Charisma decides', result: '',
        check: { skill: 'charisma', base: 0.4, perLevel: 0.08, max: 0.95,
          success: { xp: { charisma: 14 }, effects: { social: 4 }, result: 'By the end they were calling you “my oga”. You paid nothing.' },
          failure: { cost: 300, xp: { charisma: 5 }, result: 'Your grammar did not work. It cost you ₦300 instead.' } } },
      { id: 'detour', label: 'Take the long way round', hint: 'Costs a little energy', effects: { energy: -4 }, result: 'You went round. Longer, but free.' },
    ],
  },
  busker: {
    id: 'busker', icon: '🎸', title: 'A guitarist at the bus stop', modes: ['trek', 'danfo', 'keke', 'okada', 'cab', 'car'], weight: 2, beta: true,
    text: 'A young man with a battered guitar is playing highlife, and he is very good.',
    choices: [
      { id: 'tip', label: 'Tip him ₦100', hint: 'Stay for the chorus', cost: 100, effects: { fun: 8 }, xp: { music: 8 }, result: 'He played your request. You are still humming it.' },
      { id: 'listen', label: 'Listen for a moment', hint: 'Free music', effects: { fun: 3 }, result: 'One verse, then on your way.' },
    ],
  },
  holdup: {
    id: 'holdup', icon: '🚦', title: 'Hold-up on the bridge', modes: ['danfo', 'cab', 'car'], weight: 2, beta: true,
    text: 'Nothing is moving. The driver has switched off the engine and people are getting comfortable.',
    choices: [
      { id: 'chips', label: 'Buy plantain chips', hint: 'Crunch through it', cost: 200, effects: { hunger: 10 }, result: 'Salty, crunchy, gone in a minute.' },
      { id: 'nap', label: 'Close your eyes', hint: 'A small rest', effects: { energy: 4 }, result: 'You woke up when the horn started again.' },
      { id: 'gist', label: 'Join the argument about the route', hint: 'A small chat', effects: { social: 4 }, result: 'Everybody had a better route. Nobody was right.' },
    ],
  },
};

/** How long an unanswered roadside choice stays open, in seconds (original beta value). */
export const EVENT_TTL_SECONDS = 600;

/**
 * Chance outcomes rolled when a venue activity completes (original beta rules).
 *   chance = base + perLevel × level of `skill`, capped at max.
 * `once` pays the grant a single time per life; later successes give `repeat` instead.
 */
export const ACTIVITY_OUTCOMES = {
  'hub-pitch': {
    skill: 'charisma', base: 0.25, perLevel: 0.06, max: 0.85, beta: true,
    success: { once: 'funded', reward: 20000, event: 'startup.funded', moodlet: { id: 'funded', label: 'Startup Funded', value: 12, duration: 3600 },
      result: 'The panel said yes. A seed grant just landed in your account.',
      repeat: { moodlet: { id: 'investors-nodded', label: 'Investors Nodded', value: 6, duration: 1800 }, result: 'Another strong pitch. The investors want a follow-up meeting.' } },
    failure: { moodlet: { id: 'pitch-flopped', label: 'Pitch Flopped', value: -4, duration: 600 }, result: 'The panel passed this time. Work on your delivery and pitch again.' },
  },
  'hub-hack-atm': {
    skill: 'coding', base: 0.05, perLevel: 0.05, max: 0.6, beta: true,
    success: { reward: 4000, moodlet: { id: 'looking-over-shoulder', label: 'Looking Over Your Shoulder', value: -4, duration: 900 }, result: 'The machine coughed up ₦4,000. Walk away slowly.' },
    failure: { fine: 3000, moodlet: { id: 'booked', label: 'Booked at the Station', value: -10, duration: 7200 },
      result: 'Security caught you. You were fined and booked — clear your name at the Police Station.' },
  },
};
