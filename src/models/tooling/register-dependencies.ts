import { registerHooks } from 'node:module';
import type { ResolveFnOutput, ResolveHookContext } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

// Reuse an existing install without changing the checkout or its package manifest.
const dependencyRoot = process.env.MODELS_DEPENDENCY_ROOT;
if (dependencyRoot) {
  const parentURL = pathToFileURL(resolve(dependencyRoot, 'package.json')).href;
  registerHooks({
    resolve(specifier: string, context: ResolveHookContext, nextResolve: (specifier: string, context?: Partial<ResolveHookContext>) => ResolveFnOutput) {
      try { return nextResolve(specifier, context); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ERR_MODULE_NOT_FOUND' || specifier.startsWith('.') || specifier.startsWith('/') || specifier.includes(':')) throw error;
        return nextResolve(specifier, { ...context, parentURL });
      }
    },
  });
}
