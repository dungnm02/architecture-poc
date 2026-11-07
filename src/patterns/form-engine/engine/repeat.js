import { createIssue } from './issues.js'
import { RESERVED, getAtSegments } from './paths.js'

/**
 * Repeat-group helpers. This module is pure (no React, no RHF) so row building,
 * scope paths and item-key diagnostics are testable with `node --test`.
 *
 * `useFieldArray` still owns row identity: it stamps a `__key` onto each row.
 * A data `itemKey` is document data, never the React key. When a data key is
 * missing, duplicated or unsafe, `validateItemKey` records a warning only and
 * the UI continues with the hook key; async work for the group is discarded on
 * every array mutation because array operations bump the cascade epoch.
 */

const UNSAFE_KEY = /[\s.[\]'"~/]/
const MAX_KEY_LENGTH = 200

const hasControlCharacters = (value) =>
  [...value].some((character) => character.charCodeAt(0) < 32)

const isPlainObject = (value) =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const cloneValue = (value) => {
  if (value === null || typeof value !== 'object') return value
  try {
    return structuredClone(value)
  } catch {
    return Array.isArray(value) ? value.slice() : { ...value }
  }
}

function setAtPath(target, segments, value) {
  if (!Array.isArray(segments) || segments.length === 0) return

  let current = target
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index]
    if (!isPlainObject(current[segment])) current[segment] = {}
    current = current[segment]
  }

  current[segments[segments.length - 1]] = value
}

function initialSlotValue(child, slotName, slot) {
  const declared = child.defaultValue
  if (declared !== undefined) {
    if (isPlainObject(declared) && Object.hasOwn(declared, slotName)) {
      return cloneValue(declared[slotName])
    }
    if (slotName === 'value' && !isPlainObject(declared)) {
      return cloneValue(declared)
    }
  }
  return cloneValue(slot.emptyValue)
}

let fallbackSequence = 0

/**
 * Default item identity. `crypto.randomUUID` is available in browsers and
 * Node; the fallback keeps the module usable in older test harnesses.
 */
export function defaultMakeKey() {
  if (
    typeof globalThis.crypto === 'object' &&
    typeof globalThis.crypto.randomUUID === 'function'
  ) {
    return globalThis.crypto.randomUUID()
  }
  fallbackSequence += 1
  return `item-${fallbackSequence}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Build one complete row from the repeat template's child bindings. Every slot
 * is filled, so `InputWithNA` gets both its value and its N/A boolean. When the
 * group declares an `itemKey` and the template leaves it missing or empty, a
 * fresh key is generated (the template may bind a disabled ID field, as the
 * fixture does). An explicit template default always wins.
 *
 * @param {object} def RepeatGroup field definition
 * @param {() => string} [makeKey]
 * @returns {Record<string, unknown>}
 */
export function newItem(def, makeKey = defaultMakeKey) {
  const row = {}

  for (const child of def?.template ?? []) {
    for (const [slotName, binding] of Object.entries(child.binding ?? {})) {
      const slot = child.slots?.[slotName]
      const segments = binding?.segments
      if (!slot || !Array.isArray(segments) || segments.length === 0) continue
      setAtPath(row, segments, initialSlotValue(child, slotName, slot))
    }
  }

  const itemKey = def?.itemKey
  if (typeof itemKey === 'string' && itemKey !== '') {
    const existing = getAtSegments(row, [itemKey])
    if (existing === undefined || existing === null || existing === '') {
      setAtPath(row, [itemKey], makeKey())
    }
  }

  return row
}

/** Read the declared data key from one row. */
export function itemKeyOf(groupDef, row) {
  const itemKey = groupDef?.itemKey
  if (typeof itemKey !== 'string' || itemKey === '') return undefined
  return getAtSegments(row, [itemKey])
}

/**
 * The ancestor fold is carried into the scope so `resolveMode` can demote a
 * VIEW group's EDIT children without a per-item visibility rule.
 *
 * @param {object} groupDef
 * @param {number} index
 * @param {Record<string, unknown>} row
 * @param {'EDIT'|'VIEW'|'HIDDEN'} ancestorMode
 */
export function scopeFor(groupDef, index, row, ancestorMode = 'EDIT') {
  const groupSegments = groupDef?.binding?.value?.segments ?? []
  return {
    segments: [...groupSegments, String(index)],
    index,
    key: itemKeyOf(groupDef, row),
    ancestorMode,
  }
}

function keyIsSafe(value) {
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value !== 'string') return false
  if (value === '' || value.trim() === '') return false
  if (value.length > MAX_KEY_LENGTH) return false
  if (RESERVED.has(value)) return false
  return !UNSAFE_KEY.test(value) && !hasControlCharacters(value)
}

/**
 * Diagnostics for the optional data key. Warnings only; this never mutates
 * rows and never blocks the form. Callers record the issues (once per rows
 * change) and fall back to `useFieldArray`'s `__key`.
 *
 * @param {object} groupDef
 * @param {Array<Record<string, unknown>>} rows
 */
export function validateItemKey(groupDef, rows) {
  const itemKey = groupDef?.itemKey
  if (typeof itemKey !== 'string' || itemKey === '') return []
  if (!Array.isArray(rows)) return []

  const issues = []
  const seen = new Map()

  rows.forEach((row, index) => {
    const value = itemKeyOf(groupDef, row)

    if (value === undefined || value === null || value === '') {
      issues.push(
        createIssue('repeat.itemKey.missing', 'warning', {
          fieldId: groupDef.id,
          index,
          itemKey,
          fallback: 'useFieldArray.__key',
        }),
      )
      return
    }

    if (!keyIsSafe(value)) {
      issues.push(
        createIssue('repeat.itemKey.unsafe', 'warning', {
          fieldId: groupDef.id,
          index,
          itemKey,
          value,
          fallback: 'useFieldArray.__key',
        }),
      )
      return
    }

    const key = `${typeof value}:${String(value)}`
    const indexes = seen.get(key) ?? []
    indexes.push(index)
    seen.set(key, indexes)
  })

  for (const [key, indexes] of seen) {
    if (indexes.length < 2) continue
    for (const index of indexes) {
      issues.push(
        createIssue('repeat.itemKey.duplicate', 'warning', {
          fieldId: groupDef.id,
          index,
          itemKey,
          key,
          fallback: 'useFieldArray.__key',
        }),
      )
    }
  }

  return issues
}

/**
 * Find a row by its declared data key. Returns -1 when the group has no itemKey
 * or the value is absent, which is the documented discard path for stale async
 * work after a reorder.
 *
 * @param {object} groupDef
 * @param {Array<Record<string, unknown>>} rows
 * @param {unknown} keyValue
 */
export function resolveItemIndex(groupDef, rows, keyValue) {
  if (!Array.isArray(rows)) return -1
  if (typeof groupDef?.itemKey !== 'string' || groupDef.itemKey === '') return -1
  return rows.findIndex((row) => Object.is(itemKeyOf(groupDef, row), keyValue))
}
