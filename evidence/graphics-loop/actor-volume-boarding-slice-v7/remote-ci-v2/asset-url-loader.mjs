// Node-only test resolver for Vite's ?url GLB imports. The runtime adapter itself still calls
// production loadBody; this loader only turns those imported asset URLs into local file URLs.
export async function resolve(specifier, context, nextResolve) {
  if (!specifier.endsWith('?url')) return nextResolve(specifier, context)
  const resolved = await nextResolve(specifier.slice(0, -4), context)
  return { ...resolved, url: `${resolved.url}?actor-volume-v7-asset`, shortCircuit: true }
}

export async function load(url, context, nextLoad) {
  if (!url.endsWith('?actor-volume-v7-asset')) return nextLoad(url, context)
  const assetUrl = url.slice(0, -'?actor-volume-v7-asset'.length)
  // Keep a real URL string so production BODY_FILES and GLTFLoader use the same resolution path.
  return { format: 'module', source: `export default ${JSON.stringify(assetUrl)};`, shortCircuit: true }
}
