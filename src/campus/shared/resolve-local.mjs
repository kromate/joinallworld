/** Development-only resolver: reuse the owner's installed dependencies without changing
 * package.json or writing a node_modules link outside the campus lane.
 * Run: NODE_OPTIONS='--import ./src/campus/shared/resolve-local.mjs' npm test
 */
import { registerHooks, createRequire } from 'node:module';
const fallback = new URL('../../../../JoinAllworld/package.json', import.meta.url);
registerHooks({
  resolve(specifier, context, nextResolve) {
    try { return nextResolve(specifier, context); }
    catch (error) {
      if (!['ERR_MODULE_NOT_FOUND','MODULE_NOT_FOUND'].includes(error.code) || !/^(three|vite|ws|miniflare)(\/|$)/.test(specifier)) throw error;
      const owner = specifier === 'miniflare' ? new URL('../../../../JoinAllworld/deploy/tooling/package.json',import.meta.url) : fallback;
      if(specifier==='miniflare')return nextResolve(createRequire(owner).resolve(specifier),context);
      return nextResolve(specifier, {...context,parentURL:owner.href});
    }
  },
});
