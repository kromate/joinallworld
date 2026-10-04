/**
 * OWNER: character
 * Goals: the goal chip in the top-left HUD stack, and the Goals tab of the Sim sheet
 * (starter goal chain, wishes, stars, perks, dream progress).
 *
 * Ported starter behaviour (extend freely): the chip is the existing next-step guide — find a
 * job, rest or eat when the job's minimum needs are not met, go to work.
 * The panel contract is at the top of src/ui/shell.js. Styles: create ./goals.css and import it here.
 */
import { esc, money, json, placeholder } from '../dom.js';
import { JOBS } from '../../game/content/jobs.js';
import { VENUES } from '../../game/content/venues.js';

function recovery(need) {
  for (const spot of Object.values(VENUES.home.spots)) {
    const fix = spot.activities.find((activity) => !activity.unavailable && ((activity.effects?.[need] ?? 0) > 0 || (activity.effectsPerSecond?.[need] ?? 0) > 0));
    if (fix) return { spot, fix };
  }
  return null;
}

function nextStep(state, view) {
  const active = state.activeAction, running = view.activities.active;
  if (running?.reward > 0) return { icon: '⏳', title: 'Shift in progress', hint: `${money(running.reward)} when it finishes`, busy: true };
  if (active) return { icon: '⏳', title: active.kind === 'travel' ? 'On your way' : running?.label || 'Activity in progress', hint: active.kind === 'travel' ? 'Arriving shortly' : 'Finish or cancel to continue', busy: true };
  const job = state.job ? JOBS[state.job] : null;
  // Energy first, so a tired, hungry player is sent to rest before eating.
  const short = Object.entries(job?.shift.minimumNeeds || {}).filter(([need, minimum]) => state.needs[need] < minimum).map(([need]) => need).sort((a, b) => (b === 'energy') - (a === 'energy'));
  if (!job && state.location !== 'home') return { icon: '💼', title: 'Find your first job', hint: 'See the starter job', open: 'jobs' };
  if (short.length || !job) {
    const fix = recovery(short[0] || 'hunger');
    const title = short[0] === 'energy' ? 'Rest before your shift' : short[0] ? 'Eat before your shift' : 'Make yourself at home';
    return { icon: short[0] === 'energy' ? '🛏️' : '🥣', title, hint: fix ? `${fix.spot.label} → ${fix.fix.label}` : 'Eat and rest at Home', go: ['home', fix?.spot.id] };
  }
  const here = state.location === job.workplace.venue && state.spot === job.workplace.spot;
  return { icon: '💼', title: here ? 'Start your shift' : 'Work a shift', hint: here ? 'Open the activities below' : VENUES[job.workplace.venue].spots[job.workplace.spot]?.label ?? 'Your workplace', active: here, go: [job.workplace.venue, job.workplace.spot] };
}

export default [
  {
    id: 'goal-chip', title: 'Current goal', icon: '🎯', placement: 'hud', order: 10,
    render(state, view) {
      const step = nextStep(state, view);
      const attrs = step.open ? `data-open="${esc(step.open)}"` : step.go ? `data-goal-go="${json(step.go)}"` : '';
      return `<button class="life-job ${step.active || step.busy ? 'is-active' : ''}" ${attrs} ${step.busy ? 'disabled' : ''}><span>${step.icon}</span><div><strong>${esc(step.title)}</strong><small>${esc(step.hint)}</small></div></button>`;
    },
    bind(root, api) {
      root.querySelector('[data-goal-go]')?.addEventListener('click', (event) => api.goTo(...JSON.parse(event.currentTarget.dataset.goalGo)));
    },
  },
  {
    id: 'goals', title: 'Goals', icon: '🎯', placement: 'sim-tab', order: 30,
    render() { return placeholder('Goals', 'Wishes, perks and dream progress are coming soon.'); },
  },
];
