/**
 * Small settings-reading helpers shared by every adapter that resolves a
 * provider's connection facts from an untyped settings section.
 *
 * @module @sumomok/dsh-balance/settings-util
 */

/** Read one optional string from an untyped settings section. */
export function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * Walk a settings section down to one provider's profile object.
 * @param section - the namespace's resolved value, or `undefined` while unregistered.
 * @param path - path from the section root to the profile; empty means the whole section.
 * @returns the profile object, or `undefined` when the path does not resolve to one.
 */
export function profileAtPath(section: unknown, path: readonly string[]): Record<string, unknown> | undefined {
  let current: unknown = section
  for (const key of path) {
    if (typeof current !== 'object' || current === null) return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return typeof current === 'object' && current !== null && !Array.isArray(current)
    ? current as Record<string, unknown>
    : undefined
}

/**
 * Derive the conventional credential reference for a provider route, matching
 * the Models settings page's own derivation exactly (`ui-settings-models`):
 * a typed key with no explicit `apiKeyEnv` stores under this reference, so a
 * profile naming none must resolve to the same name here.
 * @param provider - provider route id (e.g. `anthropic`, `minimax-cn`).
 * @returns the derived reference name (e.g. `MINIMAX_CN_API_KEY`).
 */
export function deriveKeyRef(provider: string): string {
  return `${provider.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`
}
