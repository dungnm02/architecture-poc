/**
 * Pure registry metadata. This module deliberately has no JSX and no React or
 * RHF imports so `node --test` can import it. Renderers live in
 * `registry/renderers.js` and `registry/fields/` (M3).
 *
 * A slot entry is the complete value contract a renderer receives:
 * `{ type, emptyValue, normalize }`. Empty-value normalisation belongs here,
 * once per slot, not in each renderer.
 */

const normaliseString = (value) => {
  if (value === null || value === undefined) return ''
  return typeof value === 'string' ? value : String(value)
}

const normaliseBoolean = (value) => value === true

const normaliseArray = (value) => (Array.isArray(value) ? value : [])

const normaliseObject = (value) =>
  value && typeof value === 'object' && !Array.isArray(value) ? value : {}

const normaliseNumber = (value) => {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

/** Slot types are part of the contract even when no fixture field uses one. */
export const SLOT_TYPES = {
  string: { emptyValue: '', normalize: normaliseString },
  date: { emptyValue: '', normalize: normaliseString },
  boolean: { emptyValue: false, normalize: normaliseBoolean },
  array: { emptyValue: [], normalize: normaliseArray },
  object: { emptyValue: {}, normalize: normaliseObject },
  number: { emptyValue: null, normalize: normaliseNumber },
}

/**
 * @param {'string'|'date'|'boolean'|'array'|'object'|'number'} type
 * @param {Record<string, unknown>} [extra]
 */
export function createSlot(type, extra = {}) {
  const meta = SLOT_TYPES[type]
  if (!meta) {
    throw new Error(`Unknown slot type: ${String(type)}`)
  }
  return {
    type,
    emptyValue: meta.emptyValue,
    normalize: meta.normalize,
    ...extra,
  }
}

const isPlainObject = (value) =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

/**
 * Pure slot-type guard used before rendering a bound path. `null` is the empty
 * value for number and is tolerated for the other scalar slots so a missing
 * entity leaf degrades to empty rather than to a false type error. `undefined`
 * never reaches a slot (seed replaces it), so it is a mismatch here.
 *
 * @param {'string'|'date'|'number'|'boolean'|'array'|'object'|string} slotType
 * @param {unknown} value
 */
export function slotValueMatches(slotType, value) {
  switch (slotType) {
    case 'string':
    case 'date':
      return value === null || typeof value === 'string'
    case 'number':
      return value === null || (typeof value === 'number' && Number.isFinite(value))
    case 'boolean':
      return value === null || typeof value === 'boolean'
    case 'array':
      return Array.isArray(value)
    case 'object':
      return isPlainObject(value)
    default:
      return false
  }
}

const readSegments = (values, segments) => {
  let current = values
  for (const segment of segments) {
    if (current === null || typeof current !== 'object') return undefined
    if (!Object.hasOwn(current, segment)) return undefined
    current = current[segment]
  }
  return current
}

/**
 * Find every slot whose current value does not match its declared type. This is
 * the M3 "path type mismatched" guard: the field renders a read-only degraded
 * block, the value is left untouched, and FieldHost records one warning per
 * field instance.
 *
 * @param {object} def
 * @param {unknown} values
 * @returns {Array<{ fieldId: string, slotName: string, expected: string, actual: unknown }>}
 */
export function findSlotTypeMismatches(def, values) {
  const mismatches = []

  for (const [slotName, binding] of Object.entries(def?.binding ?? {})) {
    const slot = def?.slots?.[slotName]
    const segments = binding?.segments
    if (!slot || !Array.isArray(segments)) continue

    const actual = readSegments(values, segments)
    if (!slotValueMatches(slot.type, actual)) {
      mismatches.push({
        fieldId: def.id,
        slotName,
        expected: slot.type,
        actual,
      })
    }
  }

  return mismatches
}

const textValue = createSlot('string')
const dateValue = createSlot('date')
const booleanValue = createSlot('boolean')

export const fieldTypes = new Map([
  [
    'Text',
    {
      slots: { value: textValue },
      emptyValue: '',
    },
  ],
  [
    'Date',
    {
      slots: { value: dateValue },
      emptyValue: '',
    },
  ],
  [
    'InputWithNA',
    {
      // Two slots, written atomically by one writeSlots call. The adapter must
      // never wrap `{ target: ... }` data: RHF setValue stores it verbatim.
      slots: {
        value: textValue,
        isNA: booleanValue,
      },
      emptyValue: { value: '', isNA: false },
    },
  ],
  [
    'RepeatGroup',
    {
      slots: { value: createSlot('array') },
      emptyValue: [],
      repeat: true,
    },
  ],
  [
    'ComplexStub',
    {
      // Complex fields are not part of `properties` or RHF values.
      slots: {},
      emptyValue: null,
      complex: true,
    },
  ],
])
