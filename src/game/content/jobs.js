/**
 * OWNER: career
 * Job catalogue: the starter Community helper job plus fourteen career tracks.
 *
 * Shape of a job (other code reads `label`, `workplace` and `shift`, so keep those stable):
 *   JOBS[id] = {
 *     id, label, icon, summary, beta?,
 *     workplace: { venue, spot },        // venue id from content/venues.js; spot is always 'work'
 *     workplaceName,                     // display name used while the venue is not in the build
 *     shift: { ...activity definition }, // attached to the workplace spot by systems/career.js
 *     // career tracks only:
 *     track: true, skill, days: [weekday 0–6], ladder: [{ role, pay, skillLevel }],
 *   }
 *
 * PROVENANCE
 *   Entry role and entry pay for Tech, Banking and Music, the five-day week for those three,
 *   Tech's Monday–Friday week, the 50% starting performance, Tech's second role (Junior Dev,
 *   needing Coding 1) and its top role (CTO) were observed in the reference game. Entry role and
 *   entry pay of the other eleven tracks were reported from the reference game but not
 *   independently verified. Everything else — every other role name, the pay curve, skill
 *   requirements above level 2, which weekdays are work days, days per week for the eleven
 *   unverified tracks, shift length, need costs, XP and performance per shift — is an original
 *   beta value. The reference shift itself was never observed, so the whole shift design is
 *   original. All blurbs are original copy.
 *
 * The Community helper job is original beta gameplay, not a job from the reference game. It is
 * kept so existing saves keep working: any time of day, no ladder, one shift per
 * HELPER_COOLDOWN_SECONDS.
 */

/**
 * Seconds between Community helper shifts (original beta value). At ₦300 a shift this caps the
 * starter job at 6 shifts — ₦1,800 — per Lagos day even when played round the clock, below the
 * lowest career entry pay (₦2,400 for one shift), so it can never out-earn a career track.
 * Enforced through the activity `cooldown` field (systems/travel.js).
 */
export const HELPER_COOLDOWN_SECONDS = 4 * 3600;
/** Seconds a career shift takes (original beta value). */
export const SHIFT_SECONDS = 40;
/** Minimum needs to start a career shift, and what a completed shift uses (original beta values). */
export const SHIFT_MINIMUM_NEEDS = Object.freeze({ energy: 30, hunger: 25 });
export const SHIFT_EFFECTS = Object.freeze({ energy: -20, hunger: -12 });
/** Track-skill XP per completed shift (original beta value). */
export const SHIFT_XP = 25;
/** Performance when a role starts (50% at level 1 was observed in the reference game). */
export const START_PERFORMANCE = 50;
/** Performance gained per completed shift before modifiers (original beta value). */
export const PERFORMANCE_PER_SHIFT = 10;
/** Pay of each ladder level as a multiple of entry pay, rounded to ₦100 (original beta values). */
export const PAY_CURVE = Object.freeze([1, 1.5, 2.25, 3.5, 5.5, 9]);
/** Track-skill level needed to reach each ladder level (level 2 = skill 1 was observed for Tech). */
export const SKILL_GATES = Object.freeze([0, 1, 2, 4, 6, 8]);

/** Career shifts ignore venue opening hours: staff can clock in at any time on a work day. */
const ANY_TIME = Object.freeze({ open: 0, close: 24 });
const WEEKDAYS_MON_FRI = [1, 2, 3, 4, 5];

function track({ id, label, icon, skill, venue, workplaceName, days, entryPay, roles, summary }) {
  const ladder = roles.map((role, index) => ({
    role,
    pay: Math.round((entryPay * PAY_CURVE[index]) / 100) * 100,
    skillLevel: SKILL_GATES[index],
  }));
  return {
    id, label, icon, skill, days, ladder, summary, workplaceName, track: true,
    workplace: { venue, spot: 'work' },
    shift: {
      id: `${id}-shift`, label: `${label} shift`, icon, duration: SHIFT_SECONDS, cost: 0, reward: entryPay,
      minimumNeeds: { ...SHIFT_MINIMUM_NEEDS }, effects: { ...SHIFT_EFFECTS }, xp: { [skill]: SHIFT_XP },
      hours: ANY_TIME, tags: ['work'], careerTrack: id, beta: true,
      note: 'Original beta shift: paid on completion, one paid shift per Lagos day. Cancelling earns nothing.',
    },
  };
}

export const JOBS = {
  'community-helper': {
    id: 'community-helper', label: 'Community helper', beta: true,
    summary: 'Help at the park’s Community desk.',
    workplace: { venue: 'park', spot: 'work' }, workplaceName: 'Freedom Park',
    shift: {
      id: 'helper-shift', label: 'Community helper shift', icon: '💼', duration: 20, cost: 0,
      reward: 300, minimumNeeds: { energy: 20, hunger: 20 }, effects: { energy: -10, hunger: -5 },
      cooldown: HELPER_COOLDOWN_SECONDS, tags: ['work'], beta: true,
      note: 'Original beta rules: ₦300 on completion, energy −10, hunger −5, then a four-hour break. Cancelling earns nothing.',
    },
  },
  tech: track({
    id: 'tech', label: 'Tech', icon: '💻', skill: 'coding', venue: 'cchub', workplaceName: 'CcHub', days: WEEKDAYS_MON_FRI, entryPay: 3600,
    roles: ['Intern', 'Junior Dev', 'Developer', 'Senior Dev', 'Engineering Lead', 'CTO'],
    summary: 'Start by fixing bugs at the hub and work up to running the whole engineering floor. Coding earns the promotions.',
  }),
  banking: track({
    id: 'banking', label: 'Banking', icon: '🏦', skill: 'charisma', venue: 'office', workplaceName: 'the Office', days: WEEKDAYS_MON_FRI, entryPay: 4200,
    roles: ['Marketer', 'Account Officer', 'Relationship Manager', 'Branch Manager', 'Regional Director', 'Managing Director'],
    summary: 'Win customers one handshake at a time. The best pay at entry level, and Charisma decides who rises.',
  }),
  music: track({
    id: 'music', label: 'Music', icon: '🎤', skill: 'music', venue: 'shrine', workplaceName: 'the Shrine', days: [3, 4, 5, 6, 0], entryPay: 2700,
    roles: ['Backup Singer', 'Session Vocalist', 'Opening Act', 'Recording Artist', 'Headliner', 'Afrobeats Star'],
    summary: 'Sing behind the band until the crowd is singing your name. Music skill opens every door.',
  }),
  trading: track({
    id: 'trading', label: 'Trading', icon: '🧺', skill: 'hustle', venue: 'market', workplaceName: 'the Market', days: [1, 2, 3, 4, 5, 6], entryPay: 3000,
    roles: ['Shop Assistant', 'Stall Keeper', 'Trader', 'Wholesaler', 'Importer', 'Market Leader'],
    summary: 'Six days of buying low and selling fast. Hustle turns a borrowed stall into a market empire.',
  }),
  nursing: track({
    id: 'nursing', label: 'Nursing', icon: '🩺', skill: 'charisma', venue: 'hospital', workplaceName: 'the Hospital', days: [1, 2, 3, 5, 6], entryPay: 3300,
    roles: ['Student Nurse', 'Staff Nurse', 'Senior Nurse', 'Ward Sister', 'Matron', 'Chief Nursing Officer'],
    summary: 'Long rounds and steady hands on the ward. A calm bedside manner — Charisma — carries you up.',
  }),
  hair: track({
    id: 'hair', label: 'Hair', icon: '💇', skill: 'hustle', venue: 'salon', workplaceName: 'the Salon', days: [2, 3, 4, 5, 6, 0], entryPay: 2700,
    roles: ['Salon Assistant', 'Braider', 'Stylist', 'Senior Stylist', 'Salon Manager', 'Salon Owner'],
    summary: 'Sweep, wash, braid, repeat — then put your own name over the door. Hustle keeps the chairs full.',
  }),
  chef: track({
    id: 'chef', label: 'Chef', icon: '🍳', skill: 'cooking', venue: 'amala-shitta', workplaceName: 'Amala Shitta', days: [1, 2, 3, 4, 5, 6], entryPay: 2700,
    roles: ['Dishwasher', 'Kitchen Hand', 'Line Cook', 'Sous Chef', 'Head Chef', 'Executive Chef'],
    summary: 'From the sink to the pass of the busiest buka in town. Cooking skill is the only CV that counts.',
  }),
  dj: track({
    id: 'dj', label: 'DJ', icon: '🎧', skill: 'dance', venue: 'quilox', workplaceName: 'Quilox', days: [4, 5, 6, 0], entryPay: 3000,
    roles: ['Hype Man', 'Warm-up DJ', 'Resident DJ', 'Club DJ', 'Headline DJ', 'Superstar DJ'],
    summary: 'Four days a week keeping the floor moving. Know how to Dance and you will know what to play.',
  }),
  fitness: track({
    id: 'fitness', label: 'Fitness', icon: '🏋️', skill: 'fitness', venue: 'i-fitness', workplaceName: 'i-Fitness', days: [1, 2, 3, 4, 6], entryPay: 2700,
    roles: ['Gym Assistant', 'Class Instructor', 'Personal Trainer', 'Head Coach', 'Gym Manager', 'Fitness Director'],
    summary: 'Rack the weights today, run the gym tomorrow. Your own Fitness is the product.',
  }),
  creator: track({
    id: 'creator', label: 'Creator', icon: '📸', skill: 'photography', venue: 'rooftop', workplaceName: 'the Rooftop', days: [1, 3, 5, 6], entryPay: 2400,
    roles: ['Aspiring Creator', 'Content Assistant', 'Creator', 'Influencer', 'Brand Partner', 'Media Mogul'],
    summary: 'Four shoots a week chasing the perfect skyline shot. Photography grows the following — and the fee.',
  }),
  teaching: track({
    id: 'teaching', label: 'Teaching', icon: '📚', skill: 'charisma', venue: 'park', workplaceName: 'Freedom Park', days: WEEKDAYS_MON_FRI, entryPay: 3000,
    roles: ['Lesson Teacher', 'Class Teacher', 'Subject Lead', 'Head of Department', 'Vice Principal', 'Principal'],
    summary: 'After-school lessons under the trees, then a classroom, then a whole school. Charisma keeps a class listening.',
  }),
  event: track({
    id: 'event', label: 'Event', icon: '🎪', skill: 'hustle', venue: 'canopy-walk', workplaceName: 'the Canopy Walk', days: [4, 5, 6, 0], entryPay: 2700,
    roles: ['Canopy Crew', 'Usher', 'Event Assistant', 'Coordinator', 'Event Planner', 'Event Director'],
    summary: 'Set up the canopies, then plan the whole owambe. Thursday to Sunday, and Hustle gets you the big contracts.',
  }),
  football: track({
    id: 'football', label: 'Football', icon: '⚽', skill: 'comedy', venue: 'viewing-centre', workplaceName: 'the Viewing Centre', days: [3, 5, 6, 0], entryPay: 2400,
    roles: ['Viewing Centre Attendant', 'Match Announcer', 'Pundit', 'Commentator', 'Lead Commentator', 'Sports Presenter'],
    summary: 'Collect gate fees on match days and talk your way to the commentary box. Good banter — Comedy — is the job.',
  }),
  retail: track({
    id: 'retail', label: 'Retail', icon: '🛍️', skill: 'charisma', venue: 'palms', workplaceName: 'The Palms', days: [2, 3, 4, 5, 6, 0], entryPay: 2700,
    roles: ['Sales Rep', 'Senior Sales Rep', 'Floor Supervisor', 'Store Manager', 'Area Manager', 'Retail Director'],
    summary: 'Six days on the shop floor at the mall. Charisma closes the sale and earns the keys to the store.',
  }),
};

/** The fourteen career tracks, in listing order. */
export const TRACKS = Object.values(JOBS).filter((job) => job.track);
export const MAX_CAREER_LEVEL = PAY_CURVE.length;
