// What the Jobs and Career apps show, worked out from view.career. Pure, so it is tested without a
// browser. The rules are the engine's (systems/career.js); nothing here decides one.
import type { CareerView, JobListing } from '../../../types/view.ts'

/** Is this job's workplace open right now? The career view says so itself (`venue` is null while the workplace is not in this build). */
export const openNow = (job: Pick<JobListing, 'venue' | 'openNow'>): boolean | null => (job.venue ? job.openNow : null)

/**
 * The job whose switch is being confirmed ('quit' for the player's own job), or null when that
 * question no longer applies: the player holds the job asked about, has lost theirs, or left it.
 */
export function validAsk(asking: string | null, career: Pick<CareerView, 'employed' | 'id'>): string | null {
  if (!asking) return null
  if (asking === 'quit') return career.employed ? asking : null
  return asking === career.id || !career.employed ? null : asking
}

/** The job cards: the player's own first, workplaces that are open now before those that are closed, the rest in catalogue order. The player's own is the card at the top, so it is left out. */
export function otherJobs(jobs: readonly JobListing[]): JobListing[] {
  const rank = (job: JobListing): number => (job.current ? 0 : openNow(job) === false ? 2 : 1)
  return jobs.map((job, index) => ({ job, index })).sort((a, b) => rank(a.job) - rank(b.job) || a.index - b.index).map((item) => item.job).filter((job) => !job.current)
}

export type JobControl =
  | { kind: 'current' }
  | { kind: 'blocked'; label: string; why: string }
  | { kind: 'apply' }
  | { kind: 'confirm'; warning: string }
  | { kind: 'switch' }
  | { kind: 'transfer'; label: string }

/** What a job card offers: the one control, or the one reason there is none. `offline` is the connection's reason, or null. */
export function jobControl(job: JobListing, career: Pick<CareerView, 'employed'>, offline: string | null, asking: string | null): JobControl {
  if (job.current) return { kind: 'current' }
  if (job.blocked || offline) return job.transfer ? { kind: 'blocked', label: `Transfer to ${job.workplace}`, why: job.blocked || offline || '' } : { kind: 'blocked', label: career.employed ? 'Switch to this job' : 'Apply', why: job.blocked || offline || '' }
  if (job.transfer) return { kind: 'transfer', label: `Transfer to ${job.workplace}` }
  if (!career.employed) return { kind: 'apply' }
  if (asking === job.id) return { kind: 'confirm', warning: job.switchWarning ?? '' }
  return { kind: 'switch' }
}

/** The explanation under the Auto switch. */
export const autoWords = (on: boolean): string => (on ? 'On: you leave for work by yourself once a day. You can cancel the trip.' : 'Off: you only go to work when you choose to.')

/** The rules under "How work works" on the Jobs app: the engine's, then the app's own. */
export const jobsRules = (rules: readonly string[]): string[] => [
  ...rules,
  'Jobs whose workplace is open right now are listed first.',
  'Go automatically (track jobs): once a day you set off for work by yourself when a shift is available and you have the energy and food for it. You can cancel the trip.',
  'Shift rules, pay above the first role and work days are original beta values.',
]

/** The label of a work-day chip, said in full for a screen reader. */
export const chipWords = (chip: { name: string; work: boolean; today: boolean }): string => `${chip.name}: ${chip.work ? 'work day' : 'day off'}${chip.today ? ', today' : ''}`
