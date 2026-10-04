/**
 * OWNER: character
 * Starter goal chain, wishes and perks. Plain data only (no functions, no imports outside content/).
 *
 * Provenance: `beta: true` marks an original beta value; `betaFields` lists the original
 * fields of an otherwise observed entry. Everything else follows what was observed in the
 * reference game. Perk effect data (`fx`) uses the format documented in content/traits.js.
 */

/**
 * The starter chain, in order. Each goal pays its cash through the wallet (with a ledger line)
 * and one star, exactly once.
 *   done   how the goal completes: `events` (any of these registry events), `tags` (an
 *          'activity.completed' carrying any of these tags),
 *          `venue` (arriving at or visiting it),
 *          `hasJob` (already employed when the goal comes up)
 *          `fresh: true` — the condition only counts while this goal is the current one (so the
 *          hello that completed "Say hello to someone" does not also pay "Make a new friend")
 *   open / params / go   what tapping the goal chip does: open a panel, or walk to [venue, spot]
 *   here   the goal is done wherever the player stands: when they are not at `go`'s venue the chip
 *          points at the quickest free activity of the venue they are in instead
 *
 * THE ORDER follows the quick start: a guest arrives in a public venue, so the chain opens with
 * something enjoyable right there, then meeting someone, then settling in (which is what creates
 * the home); the home goals follow. STARTER_INTRO is how many goals come before the first one that
 * needs a home — a life that never was a guest starts the chain there, as it always did.
 */
export const STARTER_GOALS = [
  // The three quick-start goals and their rewards are original beta values.
  { id: 'first-fun', title: 'Play a round of Ayo', hint: 'Under the trees · takes 7 seconds', icon: '🎲', cash: 500, stars: 1, beta: true,
    done: { events: ['activity.completed'] }, go: ['park', 'trees'], activity: 'play-ayo', here: true },
  { id: 'say-hello', title: 'Say hello to someone', hint: 'Tap a person nearby', icon: '👋', cash: 500, stars: 1, beta: true,
    done: { events: ['npc.greeted', 'friend.made', 'relationship.changed'] }, open: 'people' },
  { id: 'settle-in', title: 'Settle in', hint: 'Choose your traits, your dream and your home', icon: '🏠', cash: 1000, stars: 1, beta: true,
    done: { events: ['life.started'] }, open: 'onboarding' },
  { id: 'eat', title: 'Eat something', hint: 'Tap the cooler or stove', icon: '🍲', cash: 500, stars: 1,
    done: { events: ['meal.eaten'], tags: ['food'] }, go: ['home', 'kitchen'] },
  { id: 'freshen-up', title: 'Freshen up', hint: 'Tap the bucket or shower', icon: '🫧', cash: 500, stars: 1,
    done: { tags: ['hygiene'] }, go: ['home', 'bathroom'] },
  { id: 'get-a-job', title: 'Get a job', hint: 'Open Phone → Jobs', icon: '💼', cash: 1000, stars: 1,
    done: { events: ['job.applied'], hasJob: true }, open: 'jobs' },
  { id: 'buy-something', title: 'Buy something new', hint: 'Open Buy and place an item', icon: '🛋️', cash: 1000, stars: 1,
    done: { events: ['item.bought'] }, open: 'buy', go: ['home'] },
  // The reference game paid this goal on arrival, but the amount was never seen on its own.
  { id: 'visit-buka', title: 'Visit the buka', hint: 'Open Map → Amala Shitta', icon: '🍛', cash: 1500, stars: 1, betaFields: ['cash'],
    done: { venue: 'amala-shitta' }, open: 'map', params: { destination: 'amala-shitta' } },
  // Completes when you greet one of a venue's regulars (Say Hello) or make a friend. The observed
  // reference paid this goal on an NPC Say Hello. Tapping the chip opens Sim → People, which
  // lists who is here; at home it says to go out first.
  { id: 'make-a-friend', title: 'Make a new friend', hint: 'Tap someone at a venue', icon: '👋', cash: 1500, stars: 1,
    done: { events: ['npc.greeted', 'friend.made'], fresh: true }, open: 'people' },
  // Only the title and hint of the last goal were observed; its reward is an original beta value.
  { id: 'work-a-shift', title: 'Work a shift', hint: 'Leave for work on time', icon: '⏰', cash: 2000, stars: 1, betaFields: ['cash', 'stars'],
    done: { events: ['shift.completed'] }, workplace: true },
];

/** Goals that come before the first one that needs a home (see THE ORDER above). */
export const STARTER_INTRO = STARTER_GOALS.findIndex((goal) => goal.id === 'eat');

/**
 * Wishes: three are active at a time and each grants WISH_STARS when it comes true.
 * The first three labels and the +3 star reward were observed; the rest of the pool, the way
 * each wish is detected and the re-roll rule are original beta values.
 *   on: 'earn'      cash earned on one Lagos day reaches `amount`
 *   on: 'activity'  an activity completes at `venue` (if given) matching `activity`, `spot` or any of `tags`
 *   on: 'visit'     arrive at `venue`
 *   on: 'event'     the registry event `event` fires `count` times (default 1)
 * A wish is only handed out while it can actually be done (its venue and activity exist).
 */
export const WISH_STARS = 3;
export const WISH_SLOTS = 3;
/** Original beta value: free re-rolls per Lagos day. */
export const WISH_REROLLS_PER_DAY = 3;
export const WISHES = [
  { id: 'earn-15k', label: 'Make ₦15,000 today', hint: 'Shifts and goal rewards before midnight all count', icon: '💰', on: 'earn', amount: 15000 },
  { id: 'park-art', label: 'See art at Freedom Park', hint: 'Map → Freedom Park → Art gallery', icon: '🖼️', on: 'activity', venue: 'park', spot: 'art', tags: ['art'] },
  { id: 'palms-movie', label: 'See a movie at The Palms', hint: 'Map → The Palms → cinema', icon: '🎬', on: 'activity', venue: 'palms', tags: ['movie', 'cinema'] },
  { id: 'work-shift', label: 'Finish a shift', hint: 'Go to your workplace and work', icon: '💼', on: 'event', event: 'shift.completed', beta: true },
  { id: 'park-chill', label: 'Chill under the trees', hint: 'Map → Freedom Park → Under the trees', icon: '🌳', on: 'activity', venue: 'park', activity: 'chill', beta: true },
  { id: 'full-nap', label: 'Finish a full nap', hint: 'Home → Bedroom, and do not wake early', icon: '🛏️', on: 'activity', venue: 'home', tags: ['sleep'], beta: true },
  { id: 'greet-three', label: 'Say hello to 3 people', hint: 'Tap people at any venue', icon: '👋', on: 'event', event: 'npc.greeted', count: 3, beta: true },
  { id: 'new-friend', label: 'Make a friend', hint: 'Keep talking to someone you like', icon: '🤝', on: 'event', event: 'friend.made', beta: true },
  { id: 'new-item', label: 'Buy something for your home', hint: 'Open Buy while at home', icon: '🛒', on: 'event', event: 'item.bought', beta: true },
  { id: 'level-up', label: 'Level up any skill', hint: 'Practise the skill you are closest on', icon: '📈', on: 'event', event: 'skill.levelup', beta: true },
  { id: 'eat-out', label: 'Eat at Amala Shitta', hint: 'Map → Amala Shitta, then order a plate', icon: '🍛', on: 'activity', venue: 'amala-shitta', tags: ['food'], beta: true },
  { id: 'gym-session', label: 'Work out at i-Fitness', hint: 'Map → i-Fitness', icon: '🏋️', on: 'activity', venue: 'i-fitness', tags: ['workout', 'fitness'], beta: true },
  { id: 'beach-day', label: 'Visit the beach', hint: 'Open Map and pick the beach', icon: '🏖️', on: 'visit', venue: 'beach', beta: true },
  { id: 'market-run', label: 'Go to the market', hint: 'Open Map and pick the market', icon: '🧺', on: 'visit', venue: 'market', beta: true },
  { id: 'library-visit', label: 'Visit the library', hint: 'Open Map and pick the library', icon: '📚', on: 'visit', venue: 'library', beta: true },
  { id: 'night-out', label: 'Dance at Quilox', hint: 'Map → Quilox, after dark', icon: '🪩', on: 'activity', venue: 'quilox', tags: ['dance', 'party'], beta: true },
];

/**
 * Perks, bought once each with stars. The first eight (name, cost, effect) were observed.
 * The rest fill the grid up to the reported 25-star top tier and are original beta content.
 */
export const PERKS = [
  { id: 'steel-bladder', label: 'Steel Bladder', icon: '🚽', cost: 6, effect: 'Bladder drops 30% slower', fx: { decay: { bladder: 0.7 } } },
  { id: 'iron-belle', label: 'Iron Belle', icon: '🍲', cost: 8, effect: 'Hunger drops 25% slower', fx: { decay: { hunger: 0.75 } } },
  { id: 'early-bird', label: 'Early Bird', icon: '🌅', cost: 8, effect: 'Energy drops 25% slower', fx: { decay: { energy: 0.75 } } },
  { id: 'never-dull', label: 'Never Dull', icon: '🎉', cost: 8, effect: 'Fun drops 25% slower', fx: { decay: { fun: 0.75 } } },
  { id: 'sweet-mouth', label: 'Sweet Mouth', icon: '🍯', cost: 10, effect: '+15% social success', fx: { social: 1.15 } },
  { id: 'connected', label: 'Connected', icon: '🏷️', cost: 10, effect: '10% off everything in Buy mode, and groceries', fx: { shop: 0.9 }, betaFields: ['groceries'] },
  { id: 'hustle-juice', label: 'Hustle Juice', icon: '🧃', cost: 12, effect: '+25% work performance gain', fx: { performance: 1.25 } },
  { id: 'fast-learner', label: 'Fast Learner', icon: '📚', cost: 14, effect: 'All skills grow 20% faster', fx: { xp: { all: 1.2 } } },
  { id: 'stay-fresh', label: 'Stay Fresh', icon: '🫧', cost: 8, effect: 'Hygiene drops 25% slower', fx: { decay: { hygiene: 0.75 } }, beta: true },
  { id: 'people-person', label: 'People Person', icon: '💬', cost: 8, effect: 'Social drops 25% slower', fx: { decay: { social: 0.75 } }, beta: true },
  { id: 'buka-regular', label: 'Buka Regular', icon: '🍛', cost: 10, effect: 'Paid meals cost 10% less', fx: { cost: { tags: ['food'], mult: 0.9 } }, beta: true },
  { id: 'area-sabi', label: 'Area Sabi', icon: '🛺', cost: 12, effect: 'Transport fares cost 20% less', fx: { fare: 0.8 }, beta: true },
  { id: 'ogas-favourite', label: "Oga's Favourite", icon: '💼', cost: 18, effect: 'Shifts pay 10% more', fx: { reward: { tags: ['work'], mult: 1.1 } }, beta: true },
  { id: 'lucky-star', label: 'Lucky Star', icon: '🌟', cost: 20, effect: 'Every wish grants 1 extra star', wishBonus: 1, fx: {}, beta: true },
  { id: 'second-wind', label: 'Second Wind', icon: '🌙', cost: 22, effect: 'Energy drops 30% slower from 9 PM to 5 AM', fx: { nightDecay: { energy: 0.7 } }, beta: true },
  { id: 'odogwu', label: 'Odogwu', icon: '👑', cost: 25, effect: 'Every need drops 15% slower', fx: { decay: { all: 0.85 } }, beta: true },
];

/** A need below this sends the rolling guide home to fix it (original beta value). */
export const GUIDE_LOW_NEED = 25;
