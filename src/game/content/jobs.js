/**
 * OWNER: career
 * Job catalogue. Each job names its workplace (an existing venue spot id from
 * content/venues.js) and its shift, which is an ordinary activity definition
 * (see systems/activities.js) that systems/career.js attaches to that spot.
 *
 * The Community helper job is original beta gameplay, not a job from the reference game.
 */
export const JOBS = {
  'community-helper': {
    id: 'community-helper', label: 'Community helper', beta: true,
    summary: 'Help at the park’s Community desk.',
    workplace: { venue: 'park', spot: 'work' },
    shift: {
      id: 'helper-shift', label: 'Community helper shift', icon: '💼', duration: 20, cost: 0,
      reward: 300, minimumNeeds: { energy: 20, hunger: 20 }, effects: { energy: -10, hunger: -5 },
      tags: ['work'], beta: true,
      note: 'Original beta rules: ₦300 on completion, energy −10, hunger −5. Cancelling earns nothing.',
    },
  },
};
