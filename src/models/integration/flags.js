/** Return whether the model-library implementation is enabled for this host URL. */
export function modelLibraryEnabled(search = globalThis.location?.search ?? '') {
  return new URLSearchParams(search).get('models') !== 'legacy';
}
