/**
 * Wraps a dynamic `import()` of a code-split chunk (a lazy-loaded library) against the one
 * failure mode that isn't really a failure of the import itself: a tab still running JS from
 * before the latest deploy tries to fetch a chunk whose hashed filename no longer exists on the
 * server. The SPA's catch-all rewrite then serves index.html instead of a 404, and the browser
 * rejects it for having the wrong MIME type to execute as a module. A full reload fixes this
 * outright by picking up the current deployment's chunk manifest, so we do that once automatically
 * rather than surfacing a misleading "this isn't supported" to the user.
 */
const RELOAD_GUARD_KEY = 'eduvillage:chunk-reload-guard'

function looksLikeStaleChunkError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return /dynamically imported module|Importing a module script failed|MIME type/i.test(message)
}

export async function loadChunk<T>(importer: () => Promise<T>): Promise<T> {
  try {
    return await importer()
  } catch (err) {
    if (looksLikeStaleChunkError(err)) {
      let alreadyTried = false
      try {
        alreadyTried = sessionStorage.getItem(RELOAD_GUARD_KEY) === '1'
      } catch {
        // sessionStorage unavailable (private mode, etc.): fall through and just rethrow below
      }
      if (!alreadyTried) {
        try {
          sessionStorage.setItem(RELOAD_GUARD_KEY, '1')
        } catch {
          // ignore - the reload itself still proceeds, just without the one-retry guard
        }
        window.location.reload()
        // The reload is already in flight; never resolve, so the caller never gets a chance to
        // show its own "not supported" error for what is actually just a stale page.
        return new Promise<T>(() => {})
      }
    }
    throw err
  }
}
