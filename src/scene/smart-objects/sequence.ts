import type { BodyPose } from '../body/poses.ts';

export interface ObjectAction {
  /** Placed-object and semantic action identity; countdown progress is excluded. */
  id: string;
  pose: Extract<BodyPose, 'sit' | 'lie' | 'bucket' | 'cook' | 'cookLow' | 'eat' | 'drink' | 'wash' | 'soak'>;
  floor: number;
  approach: { x: number; y: number; z: number; ry: number };
  use: { kind: 'seat'; x: number; top: number; z: number; ry: number } | { kind: 'floor'; x: number; y: number; z: number; ry: number };
  exit: { x: number; y: number; z: number; ry: number };
  table?: { x: number; y: number; z: number; ry: number; scale: number };
  surface?: { x: number; y: number; z: number; ry: number; w: number; d: number };
}
export type ObjectPhase = 'idle' | 'approach' | 'align' | 'enter' | 'use' | 'rest' | 'exit';
type State = { phase: 'idle' } | { phase: Exclude<ObjectPhase, 'idle'>; action: ObjectAction; elapsed: number };
export interface SequenceAdapter {
  enter(action: ObjectAction): void;
  use(action: ObjectAction, seconds: number): void;
  rest(action: ObjectAction): void;
  exit(action: ObjectAction): void;
  transitioning(): boolean;
  canUse(): boolean;
  settle(): void;
}

/** Navigation belongs to the host. Only bounded entry/use/exit requests its existing motion loop. */
export function createObjectSequence(adapter: SequenceAdapter) {
  let state: State = { phase: 'idle' }, target: ObjectAction | null = null;
  function next() { state = target ? { phase: 'approach', action: target, elapsed: 0 } : { phase: 'idle' }; }
  return {
    get phase(): ObjectPhase { return state.phase; },
    get action() { return target; },
    get presented() { return state.phase === 'enter' || state.phase === 'use' || state.phase === 'rest' || state.phase === 'exit' ? state.action : null; },
    get easing() { return state.phase === 'enter' || state.phase === 'use' || state.phase === 'exit'; },
    sync(action: ObjectAction | null) {
      if (action?.id === target?.id) {
        target = action;
        if (action && state.phase !== 'idle' && state.action.id === action.id) state.action = action;
        return;
      }
      target = action;
      if (state.phase === 'idle' || state.phase === 'approach' || state.phase === 'align') next();
      else if (state.phase !== 'exit') {
        state = { phase: 'exit', action: state.action, elapsed: 0 };
        adapter.exit(state.action);
      }
    },
    arrived(aligned: boolean) {
      if (state.phase !== 'approach' && state.phase !== 'align') return;
      state.phase = aligned ? 'enter' : 'align';
      if (aligned) adapter.enter(state.action);
    },
    step(dt: number) {
      if (state.phase === 'enter' && !adapter.transitioning()) state = { phase: 'use', action: state.action, elapsed: 0 };
      if (state.phase === 'use') {
        state.elapsed = Math.min(3, state.elapsed + Math.max(0, dt));
        if (!adapter.canUse() || state.elapsed >= 3) { adapter.rest(state.action); state.phase = 'rest'; }
        else adapter.use(state.action, state.elapsed);
      } else if (state.phase === 'exit' && !adapter.transitioning()) next();
      return state.phase === 'enter' || state.phase === 'use' || state.phase === 'exit';
    },
    settle() {
      adapter.settle();
      if (state.phase === 'enter' || state.phase === 'use') { adapter.rest(state.action); state.phase = 'rest'; }
      else if (state.phase === 'exit') next();
    },
    interrupt() { next(); },
    dispose() { target = null; state = { phase: 'idle' }; },
  };
}
