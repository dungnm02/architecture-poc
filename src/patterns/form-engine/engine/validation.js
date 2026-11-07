import Ajv from 'ajv'
import { createIssue, messageFor } from './issues.js'
import { computeModes } from './modes.js'
import { evaluate } from './conditions.js'
import {
  INDEX,
  pathKey,
  pathMatchesTemplate,
  pointerToSegments,
  substituteIndex,
} from './paths.js'

/**
 * Validation is assembled from closed, leaf-only fragments. The compiled schema
 * observes only effective-EDIT leaves, so the resolver validates the whole
 * values object directly: no projection, no clone.
 */
export const ASSEMBLER_VERSION = 1

export const FRAGMENT_KEYWORDS = new Set([
  'type',
  'enum',
  'const',
  'minLength',
  'maxLength',
  'pattern',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minItems',
  'maxItems',
])

const MAX_PATTERN = 200
const DATE_PATTERN = '^\\d{4}-\\d{2}-\\d{2}$'
const JSON_TYPES = new Set([
  'object',
  'array',
  'string',
  'number',
  'integer',
  'boolean',
  'null',
])

const SLOT_JSON_TYPE = {
  string: 'string',
  date: 'string',
  number: 'number',
  boolean: 'boolean',
  array: 'array',
  object: 'object',
}

const isPlainObject = (value) =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const STRUCTURAL_KEYWORDS = new Set([
  'allOf',
  'anyOf',
  'oneOf',
  'not',
  'if',
  'then',
  'else',
  '$ref',
])

/**
 * Validate one per-slot fragment. Leaf-only is enforced by the allowlist: no
 * allowed keyword takes an object subtree, and any unknown keyword is blocking.
 *
 * @param {unknown} fragment
 * @returns {Array<object>}
 */
export function validateFragment(fragment) {
  const issues = []

  if (!isPlainObject(fragment)) {
    issues.push(createIssue('field.validation.shape', 'blocking', {}))
    return issues
  }

  for (const [keyword, value] of Object.entries(fragment)) {
    if (!FRAGMENT_KEYWORDS.has(keyword)) {
      issues.push(
        createIssue('field.validation.keyword', 'blocking', { keyword }),
      )
      continue
    }

    const invalid = () =>
      issues.push(
        createIssue('field.validation.shape', 'blocking', { keyword }),
      )

    switch (keyword) {
      case 'type':
        if (typeof value === 'string') {
          if (!JSON_TYPES.has(value)) invalid()
        } else if (Array.isArray(value) && value.length > 0) {
          if (
            value.some(
              (type) => typeof type !== 'string' || !JSON_TYPES.has(type),
            )
          ) {
            invalid()
          }
        } else {
          invalid()
        }
        break
      case 'enum':
        if (!Array.isArray(value)) invalid()
        break
      case 'const':
        break
      case 'pattern':
        if (typeof value !== 'string') {
          invalid()
        } else if (value.length > MAX_PATTERN) {
          issues.push(
            createIssue('field.validation.pattern', 'blocking', {
              keyword,
              max: MAX_PATTERN,
            }),
          )
        } else {
          try {
            new RegExp(value)
          } catch {
            issues.push(
              createIssue('field.validation.pattern', 'blocking', {
                keyword,
              }),
            )
          }
        }
        break
      case 'minLength':
      case 'maxLength':
      case 'minItems':
      case 'maxItems':
        if (!Number.isInteger(value) || value < 0) invalid()
        break
      case 'multipleOf':
        if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
          invalid()
        }
        break
      case 'minimum':
      case 'maximum':
      case 'exclusiveMinimum':
      case 'exclusiveMaximum':
        if (typeof value !== 'number' || !Number.isFinite(value)) invalid()
        break
      default:
        invalid()
    }
  }

  return issues
}

function slotSchema(slotType, fragment, required) {
  const schema = {}

  if (isPlainObject(fragment)) {
    for (const [keyword, value] of Object.entries(fragment)) {
      if (FRAGMENT_KEYWORDS.has(keyword)) schema[keyword] = value
    }
  }

  const hasType = Object.hasOwn(schema, 'type')
  const baseType = SLOT_JSON_TYPE[slotType]

  if (!hasType && baseType) {
    // Required numbers cannot be null; optional numbers can be cleared to the
    // slot's null empty value. Optional strings deliberately stay non-nullable.
    if (slotType === 'number' && !required) {
      schema.type = ['number', 'null']
    } else {
      schema.type = baseType
    }
  }

  if (slotType === 'date' && !Object.hasOwn(schema, 'pattern')) {
    schema.pattern = DATE_PATTERN
  }

  if (required) {
    if (slotType === 'string' || slotType === 'date') {
      if (!(typeof schema.minLength === 'number' && schema.minLength >= 1)) {
        schema.minLength = 1
      }
    } else if (slotType === 'array') {
      if (!(Number.isInteger(schema.minItems) && schema.minItems >= 1)) {
        schema.minItems = 1
      }
    }
    // Required number: the type branch above already emitted a non-null type.
    // Required boolean is a no-op: false is a real value.
  }

  return schema
}

function makeNode(kind = 'object') {
  return {
    kind,
    props: new Map(),
    items: null,
    contributions: [],
    required: new Set(),
    clashRecorded: false,
  }
}

function ensureNode(root, segments) {
  let node = root

  for (const segment of segments) {
    if (node.kind === 'array') {
      if (segment !== '*') return null
      if (!node.items) node.items = makeNode('object')
      node = node.items
      continue
    }

    let child = node.props.get(segment)
    if (!child) {
      child = makeNode('object')
      node.props.set(segment, child)
    }
    node = child
  }

  return node
}

function addContribution(root, pathToFields, segments, contribution, record) {
  if (segments.length === 0) return

  const parentSegments = segments.slice(0, -1)
  const key = segments[segments.length - 1]
  const parent = ensureNode(root, parentSegments)
  if (!parent) return

  let node = parent.props.get(key)
  if (!node) {
    node = makeNode(contribution.slotType === 'array' ? 'array' : 'object')
    parent.props.set(key, node)
  }

  if (contribution.slotType === 'array') {
    node.kind = 'array'
    if (!node.items) node.items = makeNode('object')
  }

  node.contributions.push({
    schema: contribution.schema,
    def: contribution.def,
    slotName: contribution.slotName,
  })

  if (contribution.required) parent.required.add(key)

  const keyPath = pathKey(segments)
  const list = pathToFields.get(keyPath) ?? []
  if (!list.some((def) => def.id === contribution.def.id)) {
    list.push(contribution.def)
  }
  pathToFields.set(keyPath, list)

  const fieldIds = new Set(node.contributions.map((item) => item.def.id))
  if (fieldIds.size > 1 && !node.clashRecorded) {
    node.clashRecorded = true
    if (typeof record === 'function') {
      record(
        createIssue('validation.clash', 'warning', {
          path: keyPath,
          fieldIds: [...fieldIds],
        }),
      )
    }
  }
}

function mergeContributions(node) {
  if (node.contributions.length === 0) return {}
  if (node.contributions.length === 1) return node.contributions[0].schema
  return { allOf: node.contributions.map((item) => item.schema) }
}

function nodeToSchema(node) {
  if (node.kind === 'array') {
    return {
      type: 'array',
      items: node.items
        ? nodeToSchema(node.items)
        : { type: 'object', properties: {} },
      ...mergeContributions(node),
    }
  }

  // A scalar leaf is stored as an object-kind node only for uniformity; it has
  // no child properties and must not emit an empty `properties` keyword.
  if (node.props.size === 0 && node.contributions.length > 0) {
    return mergeContributions(node)
  }

  const properties = {}
  for (const [key, child] of node.props) {
    properties[key] = nodeToSchema(child)
  }

  const schema = { type: 'object', properties }
  if (node.required.size > 0) {
    schema.required = [...node.required].sort()
  }

  return { ...schema, ...mergeContributions(node) }
}

/**
 * @param {object} document
 * @param {Map<string, string>} modes
 * @param {(issue: object) => void} [record]
 * @returns {{ schema: object, pathToFields: Map<string, object[]> }}
 */
export function assembleSchema(document, modes, record) {
  const root = makeNode('object')
  const pathToFields = new Map()
  const modeFor = (id) => (modes instanceof Map ? modes.get(id) : undefined)

  const addBinding = (def, slotName, segments) => {
    if (modeFor(def.id) !== 'EDIT') return
    const slot = def.slots?.[slotName]
    if (!slot) return

    const fragment = def.validation?.[slotName]
    const required = Boolean(def.required?.[slotName] ?? slot.required)

    addContribution(
      root,
      pathToFields,
      segments,
      {
        schema: slotSchema(slot.type, fragment, required),
        slotType: slot.type,
        def,
        slotName,
        required,
      },
      record,
    )
  }

  for (const field of document.fields ?? []) {
    if (modeFor(field.id) !== 'EDIT') continue

    for (const slotName of Object.keys(field.binding ?? {})) {
      const binding = field.binding[slotName]
      if (!binding) continue
      addBinding(field, slotName, binding.segments)
    }

    if (!field.isRepeat || !Array.isArray(field.template)) continue

    const groupSegments = field.binding?.value?.segments
    if (!groupSegments) continue

    for (const child of field.template) {
      if (modeFor(child.id) !== 'EDIT') continue
      for (const slotName of Object.keys(child.binding ?? {})) {
        const binding = child.binding[slotName]
        if (!binding) continue
        addBinding(child, slotName, [
          ...groupSegments,
          '*',
          ...binding.segments,
        ])
      }
    }
  }

  return { schema: nodeToSchema(root), pathToFields }
}

/**
 * Cache key for a document's effective-EDIT set. One entry per field/slot;
 * template children appear once, never once per row.
 */
export function signature(document, modes) {
  const entries = []
  const modeFor = (id) => (modes instanceof Map ? modes.get(id) : undefined)

  for (const field of document.fields ?? []) {
    if (modeFor(field.id) !== 'EDIT') continue

    for (const slotName of Object.keys(field.binding ?? {})) {
      const binding = field.binding[slotName]
      if (!binding) continue
      entries.push([field.id, slotName, pathKey(binding.segments)])
    }

    if (!field.isRepeat || !Array.isArray(field.template)) continue

    const groupSegments = field.binding?.value?.segments
    if (!groupSegments) continue

    for (const child of field.template) {
      if (modeFor(child.id) !== 'EDIT') continue
      for (const slotName of Object.keys(child.binding ?? {})) {
        const binding = child.binding[slotName]
        if (!binding) continue
        entries.push([
          child.id,
          slotName,
          pathKey([...groupSegments, '*', ...binding.segments]),
        ])
      }
    }
  }

  entries.sort((left, right) => {
    const a = `${left[0]}\u0000${left[1]}\u0000${left[2]}`
    const b = `${right[0]}\u0000${right[1]}\u0000${right[2]}`
    return a < b ? -1 : a > b ? 1 : 0
  })

  return JSON.stringify([
    ASSEMBLER_VERSION,
    document.id,
    document.version,
    entries,
  ])
}

/** Bounded LRU of `{ validate, pathToFields }` entries. */
export function createValidatorCache({ max = 20 } = {}) {
  const store = new Map()
  const limit = Number.isInteger(max) && max >= 0 ? max : 20

  return {
    validatorFor(key, build) {
      if (store.has(key)) {
        const cached = store.get(key)
        store.delete(key)
        store.set(key, cached)
        return cached
      }

      const value = build()
      store.set(key, value)

      while (store.size > limit) {
        const oldest = store.keys().next().value
        store.delete(oldest)
      }

      return value
    },
    get size() {
      return store.size
    },
  }
}

function lookupDefs(pathToFields, segments) {
  if (!(pathToFields instanceof Map)) return null

  const exact = pathToFields.get(pathKey(segments))
  if (exact) return exact

  for (const [key, defs] of pathToFields) {
    if (!key.includes('*')) continue
    const templateSegments = key.split('/')
    if (pathMatchesTemplate(templateSegments, segments)) return defs
  }

  return null
}

function errorSegments(error) {
  const params = error?.params ?? {}
  let segments = pointerToSegments(error?.instancePath ?? '')

  if (error?.keyword === 'required') {
    if (typeof params.missingProperty !== 'string') return null
    segments = [...segments, params.missingProperty]
  } else if (error?.keyword === 'additionalProperties') {
    if (typeof params.additionalProperty !== 'string') return null
    segments = [...segments, params.additionalProperty]
  }

  return segments
}

function setAt(root, segments, value) {
  if (!Array.isArray(segments) || segments.length === 0) return false

  let container = root

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]
    const last = index === segments.length - 1
    const numeric = INDEX.test(segment)

    if (last) {
      if (numeric) {
        if (!Array.isArray(container)) return false
        const position = Number(segment)
        while (container.length <= position) container.push(null)
        if (container[position] != null) return false
        container[position] = value
        return true
      }

      if (!isPlainObject(container)) return false
      if (container[segment] != null) return false
      container[segment] = value
      return true
    }

    const nextNumeric = INDEX.test(segments[index + 1])

    if (numeric) {
      if (!Array.isArray(container)) return false
      const position = Number(segment)
      while (container.length <= position) container.push(null)
      if (container[position] == null) {
        container[position] = nextNumeric ? [] : {}
      }
      container = container[position]
    } else {
      if (!isPlainObject(container)) return false
      if (container[segment] == null) {
        container[segment] = nextNumeric ? [] : {}
      }
      container = container[segment]
    }

    if (nextNumeric && !Array.isArray(container)) return false
    if (!nextNumeric && !isPlainObject(container)) return false
  }

  return false
}

function addRoot(errors, error) {
  if (errors.root) return
  errors.root = {
    type: 'root',
    message: error === 'internal' ? messageFor('internal') : messageFor('root'),
  }
}

/**
 * Map AJV errors onto RHF's hierarchical error object. Arrays use null holes so
 * indices line up with field array rows.
 *
 * @param {{ validate: Function, pathToFields: Map<string, object[]> }} compiled
 * @param {unknown} values
 */
export function mapErrors(compiled, values) {
  const errors = {}

  if (!compiled || typeof compiled.validate !== 'function') {
    addRoot(errors, 'internal')
    return errors
  }

  if (!compiled.validate.errors) {
    let valid
    try {
      valid = compiled.validate(values)
    } catch {
      addRoot(errors, 'internal')
      return errors
    }
    if (valid) return errors
  }

  const list = compiled.validate.errors ?? []
  if (list.length === 0) {
    addRoot(errors, 'root')
    return errors
  }

  for (const error of list) {
    if (STRUCTURAL_KEYWORDS.has(error?.keyword)) {
      addRoot(errors, error)
      continue
    }

    const segments = errorSegments(error)
    if (!segments) {
      addRoot(errors, error)
      continue
    }

    const defs = lookupDefs(compiled.pathToFields, segments)
    if (!defs || defs.length === 0) {
      addRoot(errors, error)
      continue
    }

    const label = defs[0]?.label
    setAt(errors, segments, {
      type: error.keyword,
      message: messageFor(error, label),
    })
  }

  return errors
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

function defsForSegments(document, segments) {
  if (!Array.isArray(segments) || segments.length === 0) return []

  if (!segments.includes('*')) {
    const entries = document.bindings?.get(pathKey(segments))
    if (entries) return entries.map((entry) => entry.def)
  }

  const defs = []
  for (const entries of document.templateBindings?.values() ?? []) {
    for (const entry of entries) {
      const group = document.fieldsById?.get(entry.groupId)
      const groupSegments = group?.binding?.value?.segments
      if (!groupSegments) continue
      const template = [...groupSegments, '*', ...entry.segments]
      if (template.length !== segments.length) continue
      const matches = template.every((segment, index) =>
        segment === '*' ? segments[index] === '*' : segment === segments[index],
      )
      if (matches && !defs.some((def) => def.id === entry.def.id)) {
        defs.push(entry.def)
      }
    }
  }
  return defs
}

function allEdit(defs, modes) {
  if (!Array.isArray(defs) || defs.length === 0) return false
  if (!(modes instanceof Map)) return false
  return defs.every((def) => modes.get(def.id) === 'EDIT')
}

function groupForSegments(document, groupSegments) {
  const key = pathKey(groupSegments)
  for (const field of document.fields ?? []) {
    if (!field.isRepeat) continue
    if (pathKey(field.binding?.value?.segments ?? []) === key) return field
  }
  return null
}

/**
 * Run cross-field rules after AJV. AJV wins on a path: an existing error is
 * never overwritten. Rules compile only when target and every dependency are
 * EDIT; group targets resolve `*` per row.
 */
export function applyCrossField(engine, values, modes, errors) {
  const document = engine?.document
  const output = isPlainObject(errors) ? errors : {}
  if (!document || !Array.isArray(document.validations)) return output

  for (const rule of document.validations) {
    try {
      if (!rule || !Array.isArray(rule.target)) continue

      const wildcardIndex = rule.target.indexOf('*')
      const groupSegments =
        wildcardIndex >= 0 ? rule.target.slice(0, wildcardIndex) : null
      const group = groupSegments
        ? groupForSegments(document, groupSegments)
        : null

      if (groupSegments && !group) continue
      if (group && modes?.get?.(group.id) !== 'EDIT') continue

      const targetDefs = defsForSegments(document, rule.target)
      const dependencyDefs = Array.isArray(rule.dependsOn)
        ? rule.dependsOn.flatMap((segments) =>
            defsForSegments(document, segments),
          )
        : []

      if (!allEdit(targetDefs, modes) || !allEdit(dependencyDefs, modes)) {
        continue
      }

      if (groupSegments) {
        const rows = readValue(values, groupSegments)
        const rowCount = Array.isArray(rows) ? rows.length : 0
        for (let index = 0; index < rowCount; index += 1) {
          if (!evaluate(rule.invalidWhen, values, { itemIndex: index })) {
            continue
          }
          setAt(output, substituteIndex(rule.target, index), {
            type: 'custom',
            message: rule.message,
          })
        }
        continue
      }

      if (!evaluate(rule.invalidWhen, values)) continue
      setAt(output, rule.target, {
        type: 'custom',
        message: rule.message,
      })
    } catch {
      // A broken cross-field rule must not take down AJV validation.
    }
  }

  return output
}

const AJV_OPTIONS = {
  allErrors: true,
  strict: true,
  coerceTypes: false,
  useDefaults: false,
  removeAdditional: false,
  $data: false,
  $async: false,
  allowUnionTypes: true,
}

/**
 * Build the synchronous resolver. The engine owns the cache; this factory only
 * orchestrates modes -> assembly -> AJV -> mapping -> cross-field.
 */
export function createResolver(engine) {
  return (values) => {
    try {
      const ctx = engine.ctx()
      const modes = computeModes(engine.document, values, ctx)
      const key = signature(engine.document, modes)
      const compiled = engine.validatorFor(key, () => {
        const { schema, pathToFields } = assembleSchema(
          engine.document,
          modes,
          engine.record,
        )
        const ajv = new Ajv(AJV_OPTIONS)
        return { validate: ajv.compile(schema), pathToFields }
      })

      let errors = {}
      if (!compiled.validate(values)) {
        errors = mapErrors(compiled, values)
      }

      return {
        values,
        errors: applyCrossField(engine, values, modes, errors),
      }
    } catch (err) {
      return {
        values,
        errors: {
          root: { type: 'root', message: messageFor('internal', err) },
        },
      }
    }
  }
}
