/**
 * What the campus attaches to every life's catalogue whether or not its rules are loaded: the Aluta volunteering activity (it is
 * listed in the destination cards and weighed by the goal guide), and the veto a life that is not a current student gets for it.
 * games.ts uses these for the real rules; the browser's stand-in for that system (slices.ts) uses the same values.
 */
import { cityRules } from '../../game/cities/registry.ts';
import type { Block } from '../../types/content.ts';
import type { AttachedActivity } from '../../types/registry.ts';

export const VOLUNTEER_RULES = Object.freeze({ seconds: 45, fun: 5, xp: 5 });

export const VOLUNTEER_ACTIVITY: Readonly<AttachedActivity> = Object.freeze<AttachedActivity>({
  id: 'unilag-volunteer', label: 'Aluta volunteering', icon: '🤝', duration: VOLUNTEER_RULES.seconds,
  cost: 0, reward: 0, effects: { fun: VOLUNTEER_RULES.fun }, xp: { charisma: VOLUNTEER_RULES.xp },
  tags: ['aluta', 'volunteering', 'community'], beta: true,
  note: 'Original beta activity: once per day, no cash reward.',
  where: { venue: 'unilag', spot: 'student-union', spotLabel: 'Student Union', spotIcon: '🤝' },
});

export const STUDENT_REQUIRED = 'Matriculate as a current UNILAG student before joining campus games or community activities.';
export const STUDENT_REQUIRED_BLOCK: Block<'student_required'> = { code: 'student_required', reason: STUDENT_REQUIRED };

/** The campus belongs to the cities whose module names it (src/game/cities/<city>/rules.ts `campus`). */
export const hasCampus = (cityId: string): boolean => cityRules(cityId)?.campus === 'unilag';
