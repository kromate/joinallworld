/**
 * OWNER: career
 * Jobs, schedules, shifts, performance and promotion.
 *
 * Ported starter behaviour (extend freely): one job at a time, applying is free and instant,
 * a job's shift is an ordinary activity attached to its workplace spot, and each completed
 * shift increments completedShifts.
 * Action: 'apply-job' { id }.
 * State keys: job (job id | null) and completedShifts are legacy top-level keys that other
 * code reads (activities check state.job); put everything new under `state.career`.
 * Emits: 'job.applied' { job }, 'shift.completed' { job, activity }.
 */
import { emit } from '../registry.js';
import { fail, ok, safeCount } from '../util.js';
import { JOBS } from '../content/jobs.js';

export default {
  id: 'career',
  stateKeys: ['job', 'completedShifts', 'career'],
  sanitize(input, state) {
    state.job = typeof input.job === 'string' && Object.hasOwn(JOBS, input.job) ? input.job : null;
    state.completedShifts = safeCount(input.completedShifts) ? input.completedShifts : 0;
    state.career = {};
  },
  actions: {
    'apply-job'(state, payload, ctx) {
      if (state.activeAction) return fail(state, 'busy', 'Finish or cancel your current action before applying.');
      const job = typeof payload?.id === 'string' && Object.hasOwn(JOBS, payload.id) ? JOBS[payload.id] : null;
      if (!job) return fail(state, 'invalid_job', 'Choose a job from the Jobs list.');
      if (state.job === job.id) {
        state.message = `You already work as a ${job.label}. Visit your workplace to start a shift.`;
        return ok(state, 'already_employed');
      }
      state.job = job.id;
      state.message = `${job.label} job accepted. Visit your workplace to work a shift.`;
      emit(state, 'job.applied', { job: job.id }, ctx);
      return ok(state, 'applied');
    },
  },
  activities: Object.values(JOBS).filter((job) => job.shift).map((job) => ({ ...job.shift, requiresJob: job.id, where: job.workplace })),
  modifiers: {
    'activity.block': (value, state, { def }) => value || (def.requiresJob && state.completedShifts >= Number.MAX_SAFE_INTEGER
      ? { code: 'balance_limit', reason: 'Your shift count has reached its supported limit.' } : null),
  },
  on: {
    'activity.completed'(state, { def }, ctx) {
      if (!def.requiresJob) return;
      state.completedShifts += 1;
      emit(state, 'shift.completed', { job: def.requiresJob, activity: def.id }, ctx);
    },
  },
  advance() {},
  view(state) { return { job: state.job ? JOBS[state.job] : null, completedShifts: state.completedShifts }; },
};
