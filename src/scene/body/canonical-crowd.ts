/** Demand-loaded canonical people; rendering and resources remain owned by the scene/kit. */
import { normalizeLook } from '../characters.ts';

export interface CanonicalCrowdSpec {
  id: string;
  look: unknown;
  seed: string;
  x: number;
  y: number;
  z: number;
  ry: number;
  scale: number;
}

export interface CanonicalCrowdActor { dispose(): void }

interface Entry<Actor> {
  spec: CanonicalCrowdSpec;
  signature: string;
  revision: number;
  actor: Actor | null;
  failed: boolean;
}

export function createCanonicalCrowd<Actor extends CanonicalCrowdActor>(options: {
  load(spec: CanonicalCrowdSpec): Promise<Actor>;
  place(actor: Actor, spec: CanonicalCrowdSpec): void;
  mount(actor: Actor, id: string): void;
  changed(): void;
  failed?(id: string, error: unknown): void;
  /** Give input/painting a task boundary between cached actor clones; no work while idle. */
  yieldBetweenActors?(): Promise<void>;
}) {
  const entries = new Map<string, Entry<Actor>>();
  let started = false, disposed = false, pumping = false;
  let loading: string | null = null;
  let syncGeneration = 0;

  function releaseActor(entry: Entry<Actor>) {
    const actor = entry.actor;
    entry.actor = null;
    actor?.dispose();
  }

  /** One clone at a time; shared template/module loading is provided by loadBody. */
  async function pump() {
    if (!started || disposed || pumping) return;
    pumping = true;
    try {
      while (!disposed) {
        const pending = [...entries.entries()].find(([, entry]) => !entry.actor && !entry.failed);
        if (!pending) break;
        const [id, entry] = pending, revision = entry.revision, snapshot = entry.spec;
        loading = id;
        let candidate: Actor | null = null;
        let committed: Actor | null = null;
        const current = () => !disposed && entries.get(id) === entry && entry.revision === revision;
        try {
          candidate = await options.load(snapshot);
          if (!current()) {
            candidate.dispose(); candidate = null; continue;
          }
          // Position/scale can change during a fetch without invalidating its immutable look.
          options.place(candidate, entry.spec);
          if (!current()) { candidate.dispose(); candidate = null; continue; }
          options.mount(candidate, id);
          if (!current()) { candidate.dispose(); candidate = null; continue; }
          entry.actor = candidate;
          committed = candidate;
          candidate = null;
          // Ownership has transferred. A callback may remove/replace the entry or dispose the scene.
          options.changed();
        } catch (error) {
          candidate?.dispose();
          if (committed && entry.actor === committed) releaseActor(entry);
          if (current()) {
            entry.failed = true;
            options.failed?.(id, error);
          }
        } finally {
          loading = null;
          if (!disposed && options.yieldBetweenActors && [...entries.values()].some(entry => !entry.actor && !entry.failed)) {
            await options.yieldBetweenActors();
          }
        }
      }
    } finally { pumping = false; }
  }

  return {
    sync(specs: readonly CanonicalCrowdSpec[]) {
      if (disposed) return;
      const generation = ++syncGeneration;
      const currentSync = () => !disposed && generation === syncGeneration;
      const keep = new Set<string>();
      for (const input of specs) {
        if (!input.id || keep.has(input.id) || ![input.x, input.y, input.z, input.ry, input.scale].every(Number.isFinite) || input.scale <= 0) continue;
        keep.add(input.id);
        // Own the normalized look snapshot. A caller mutating its record cannot change an in-flight identity.
        const look = normalizeLook(input.look, input.seed);
        const signature = JSON.stringify([input.seed, look]);
        const spec = { ...input, look: JSON.parse(JSON.stringify(look)) as unknown };
        let entry = entries.get(input.id);
        if (!entry) {
          entry = { spec, signature, revision: 0, actor: null, failed: false };
          entries.set(input.id, entry);
        } else {
          if (entry.signature !== signature) {
            entry.revision += 1;
            entry.failed = false;
            entry.signature = signature;
            entry.spec = spec;
            releaseActor(entry);
            if (!currentSync()) return;
          }
          entry.spec = spec;
          if (entry.actor) {
            const actor = entry.actor, revision = entry.revision;
            try { options.place(actor, spec); }
            catch (error) {
              if (entry.actor === actor) releaseActor(entry);
              if (currentSync() && entries.get(input.id) === entry && entry.revision === revision) {
                entry.failed = true; options.failed?.(input.id, error);
              }
            }
            if (!currentSync()) return;
          }
        }
      }
      for (const [id, entry] of entries) if (!keep.has(id)) {
        entries.delete(id); releaseActor(entry);
        if (!currentSync()) return;
      }
      void pump();
    },
    /** The scene calls this only after its first supported renderer frame. */
    start() { if (!disposed) { started = true; void pump(); } },
    get(id: string): Actor | null { return entries.get(id)?.actor ?? null; },
    /** Allows hosts to report public and authored populations separately on one shared queue. */
    get loadingId(): string | null { return disposed ? null : loading; },
    get counts() {
      const canonical = [...entries.values()].filter(entry => entry.actor !== null).length;
      return { desired: entries.size, canonical, procedural: entries.size - canonical, loading: !disposed && loading !== null ? 1 : 0 };
    },
    /** Failed loads stay still until a real retry; never create an idle retry/render loop. */
    retry() { if (!disposed) { for (const entry of entries.values()) entry.failed = false; void pump(); } },
    dispose() {
      if (disposed) return;
      disposed = true;
      const owned = [...entries.values()];
      entries.clear();
      for (const entry of owned) releaseActor(entry);
    },
  };
}
