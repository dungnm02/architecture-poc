// Shared list-shape diff: the one piece of the `many` shape worth not repeating.
// Working `items` (drafts, new ones have no id) vs the server `baseline` array.

const defaultKey = (row) => row.id

export function shallowEqual(a, b) {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a == null || b == null) return false
  const keysA = Object.keys(a)
  const keysB = Object.keys(b)
  if (keysA.length !== keysB.length) return false
  return keysA.every((key) => Object.is(a[key], b[key]))
}

export function diffLists(items = [], baseline = [], { keyOf = defaultKey, equals = shallowEqual } = {}) {
  const baselineByKey = new Map(baseline.map((row) => [keyOf(row), row]))
  const seenKeys = new Set()
  const added = []
  const updated = []

  for (const item of items) {
    const key = keyOf(item)
    if (key == null) {
      added.push(item)
      continue
    }
    seenKeys.add(key)
    const serverRow = baselineByKey.get(key)
    if (serverRow === undefined) added.push(item)
    else if (!equals(item, serverRow)) updated.push(item)
  }

  const removed = baseline.filter((row) => !seenKeys.has(keyOf(row)))

  return { added, updated, removed, isDirty: added.length > 0 || updated.length > 0 || removed.length > 0 }
}
