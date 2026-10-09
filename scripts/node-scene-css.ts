import { registerHooks } from 'node:module';

// Headless scene checks need code imports, not browser stylesheets.

registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith('.css')) return { format: 'module', source: 'export default {};', shortCircuit: true };
    return nextLoad(url, context);
  },
});
