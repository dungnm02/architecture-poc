/**
 * Seed every bound path with its slot's empty value. Unbound entity data is
 * preserved verbatim, and `undefined` must never reach RHF as a value.
 */

const isPlainObject = (value) =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

/** @param {'string'|'date'|'number'|'boolean'|'array'|'object'|string} slotType */
export function emptyValueFor(slotType) {
  switch (slotType) {
    case 'string':
    case 'date':
      return ''
    case 'number':
      return null
    case 'boolean':
      return false
    case 'array':
      return []
    case 'object':
      return {}
    default:
      return ''
  }
}

function ensureParent(root, segments) {
  let current = root

  for (const segment of segments) {
    if (!isPlainObject(current)) return null

    if (current[segment] === undefined) {
      current[segment] = {}
    } else if (!isPlainObject(current[segment])) {
      // A mismatched container is left untouched; parse/degrade handles it.
      return null
    }

    current = current[segment]
  }

  return current
}

function seedLeaf(target, segments, value) {
  if (!Array.isArray(segments) || segments.length === 0) return

  const parent = ensureParent(target, segments.slice(0, -1))
  if (!parent) return

  const key = segments[segments.length - 1]
  if (parent[key] === undefined) parent[key] = value
}

function readValue(values, segments) {
  let current = values
  for (const segment of segments) {
    if (current === null || typeof current !== 'object') return undefined
    if (!Object.hasOwn(current, segment)) return undefined
    current = current[segment]
  }
  return current
}

/**
 * Seed a cloned entity in place and return it. Existing argument rows are
 * extended with template child values; no phantom rows are created.
 *
 * @param {object} document
 * @param {object} data
 */
export function seedBoundPaths(document, data) {
  if (!isPlainObject(data)) return data

  for (const entries of document.bindings?.values() ?? []) {
    for (const entry of entries) {
      const slot = entry.def?.slots?.[entry.slotName]
      if (!slot) continue
      seedLeaf(data, entry.segments, emptyValueFor(slot.type))
    }
  }

  for (const field of document.fields ?? []) {
    if (!field.isRepeat || !Array.isArray(field.template)) continue

    const groupSegments = field.binding?.value?.segments
    if (!groupSegments) continue

    const rows = readValue(data, groupSegments)
    if (!Array.isArray(rows)) continue

    for (const row of rows) {
      if (!isPlainObject(row)) continue

      for (const child of field.template) {
        for (const [slotName, binding] of Object.entries(child.binding ?? {})) {
          const slot = child.slots?.[slotName]
          if (!slot) continue
          seedLeaf(row, binding.segments, emptyValueFor(slot.type))
        }
      }
    }
  }

  return data
}
