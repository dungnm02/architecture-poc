import { evaluate } from './conditions.js'
import { pathKey } from './paths.js'

/**
 * Visibility is indexed once per document. A rule hides exactly one target
 * field (or whole group); template children are rejected at parse. The index is
 * keyed by field id, not by rule id, so a field's render can look up its own
 * rules without scanning the document.
 *
 * @param {object} document
 * @returns {Map<string, object[]>}
 */
export function buildVisibilityIndex(document) {
  const index = new Map()

  for (const rule of document?.rules?.visibility ?? []) {
    if (!rule || typeof rule.target !== 'string') continue
    const rules = index.get(rule.target)
    if (rules) {
      rules.push(rule)
    } else {
      index.set(rule.target, [rule])
    }
  }

  return index
}

const isForced = (forcedHidden, fieldId) => {
  if (!forcedHidden) return false
  if (typeof forcedHidden.has === 'function') return forcedHidden.has(fieldId)
  if (typeof forcedHidden === 'function') return Boolean(forcedHidden(fieldId))
  return false
}

/**
 * Evaluate only the field's own rules. Invalid visibility targets never reach
 * the index: document parse has already moved them to `document.forcedHidden`.
 *
 * `getValues` is a function so the condition sees live values at evaluation
 * time rather than a snapshot captured when the subscription was created.
 *
 * @param {string} fieldId
 * @param {() => unknown} getValues
 * @param {{ index?: Map<string, object[]>, forcedHidden?: Set<string>|Function }} [options]
 */
export function isHidden(fieldId, getValues, options = {}) {
  if (isForced(options.forcedHidden, fieldId)) return true

  const rules = options.index?.get?.(fieldId)
  if (!rules || rules.length === 0) return false

  const values = typeof getValues === 'function' ? getValues() : getValues

  return rules.some((rule) => {
    if (!rule?.when) return false
    try {
      return Boolean(evaluate(rule.when, values))
    } catch {
      // A condition evaluator failure must fail closed for that rule. The rule
      // was validated at parse; this is defence in depth, not a policy channel.
      return true
    }
  })
}

/**
 * Union of every rule dependency for one field. The result is a segment-array
 * list so callers convert to RHF names only at the subscription boundary.
 *
 * @param {string} fieldId
 * @param {Map<string, object[]>} index
 * @returns {string[][]}
 */
export function watchedPaths(fieldId, index) {
  const rules = index?.get?.(fieldId) ?? []
  const seen = new Set()
  const paths = []

  for (const rule of rules) {
    for (const segments of rule?.dependsOn ?? []) {
      if (!Array.isArray(segments) || segments.length === 0) continue
      const key = pathKey(segments)
      if (seen.has(key)) continue
      seen.add(key)
      paths.push(segments)
    }
  }

  return paths
}
