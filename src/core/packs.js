// Whether this copy of the extension can run the optional packs (vendor/packs, plus builds only). Both packs
// are WebAssembly, and only the plus manifests allow it in extension pages (tools/build-plus.mjs). Reading the
// manifest first spares the default builds a request for a pack file they don't have, which Chrome logs as
// an error on the page.

/** false in an extension whose manifest can't run WebAssembly; true elsewhere (then ask for the file). */
export function packsAllowed(manifest) {
  let m = manifest;
  try {
    m ??= globalThis.chrome?.runtime?.getManifest?.();
  } catch {
    /* not an extension page */
  }
  if (!m) return true;
  return /'wasm-unsafe-eval'/.test(m.content_security_policy?.extension_pages || '');
}
