/**
 * Resolve a slot binding to absolute RHF segments. Top-level fields already
 * carry absolute bindings; repeat-group template children are relative and rely
 * on the row scope (group segments plus the row index) supplied by FieldHost.
 *
 * This stays pure so M5 can test scope building without mounting React.
 *
 * @param {{ binding?: Record<string, { segments?: string[], relative?: boolean }> }} def
 * @param {string} slotName
 * @param {{ segments?: string[] } | null} [scope]
 * @returns {string[]}
 */
export function slotSegments(def, slotName, scope = null) {
  const binding = def?.binding?.[slotName]
  if (!binding || !Array.isArray(binding.segments)) return []

  if (!binding.relative) return [...binding.segments]

  return [...(scope?.segments ?? []), ...binding.segments]
}
