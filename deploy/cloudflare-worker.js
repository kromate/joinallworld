// Release compatibility shim: the release policy (kromate/allworld, scripts/package-joinallworld.mjs) bundles this exact path.
// It only re-exports the TypeScript Worker, which esbuild bundles; it can go when the policy names cloudflare-worker.ts.
export * from './cloudflare-worker.ts';
export { default } from './cloudflare-worker.ts';
