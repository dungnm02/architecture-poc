import { createIssue } from './issues.js'

/** Mode is a lattice: HIDDEN beats VIEW beats EDIT. */
export const RANK = { HIDDEN: 0, VIEW: 1, EDIT: 2 }

/** @param {'HIDDEN'|'VIEW'|'EDIT'} a @param {'HIDDEN'|'VIEW'|'EDIT'} b */
export function lower(a, b) {
  if (!(a in RANK) || !(b in RANK)) return 'HIDDEN'
  return RANK[b] < RANK[a] ? b : a
}

const isMode = (value) => value === 'EDIT' || value === 'VIEW'

/**
 * Permission payloads are untrusted. Only exact 'EDIT'/'VIEW' survive; every
 * other value is dropped with a warning and later resolves to HIDDEN. This is
 * an allowlist, not a coercion.
 *
 * @param {Map<string, unknown>|Record<string, unknown>|null|undefined} raw
 * @returns {{ permissions: Map<string, 'EDIT'|'VIEW'>, issues: object[] }}
 */
export function normalizePermissions(raw) {
  const permissions = new Map()
  const issues = []

  if (raw === undefined || raw === null) return { permissions, issues }

  let entries
  if (raw instanceof Map) {
    entries = raw.entries()
  } else if (typeof raw === 'object' && !Array.isArray(raw)) {
    entries = Object.entries(raw)
  } else {
    issues.push(createIssue('permission.invalid', 'warning', { key: null }))
    return { permissions, issues }
  }

  for (const [key, value] of entries) {
    if (isMode(value)) {
      permissions.set(key, value)
    } else {
      issues.push(createIssue('permission.invalid', 'warning', { key, value }))
    }
  }

  return { permissions, issues }
}

function readPermission(permissions, key) {
  if (!permissions) return undefined
  if (permissions instanceof Map) return permissions.get(key)
  if (typeof permissions === 'object' && Object.hasOwn(permissions, key)) {
    return permissions[key]
  }
  return undefined
}

function permissionKeyFor(def, ctx) {
  const byField = ctx.permissionKeyByField
  if (byField instanceof Map) {
    const mapped = byField.get(def.id)
    if (mapped !== undefined) return mapped
  } else if (byField && typeof byField === 'object' && def.id in byField) {
    return byField[def.id]
  }
  return def.permissionKey ?? def.id
}

function scopeSegments(scope) {
  if (!scope || !Array.isArray(scope.segments)) return []
  return scope.segments
}

function isHidden(def, getValues, ctx) {
  if (def.forcedHidden) return true

  const visibility = ctx.visibility
  if (typeof visibility === 'function') {
    return Boolean(visibility(def.id, getValues, ctx))
  }
  if (visibility && typeof visibility.has === 'function') {
    return visibility.has(def.id)
  }
  return false
}

/**
 * @param {object} def
 * @param {() => unknown} getValues
 * @param {{ segments?: string[], index?: number|null, key?: unknown, ancestorMode?: string }|null} scope
 * @param {{ permissions?: Map<string, string>, permissionKeyByField?: Map<string, string>, formMode?: string, visibility?: Function }} ctx
 */
export function resolveMode(def, getValues, scope, ctx = {}) {
  const key = permissionKeyFor(def, ctx)
  const grant = readPermission(ctx.permissions, key)

  // Missing or invalid grants are HIDDEN in every form mode. The frontend
  // never infers read access from the form mode.
  if (!isMode(grant)) return 'HIDDEN'

  if (isHidden(def, getValues, ctx)) return 'HIDDEN'

  const ancestor = ancestorMode(scope)
  if (ancestor === 'HIDDEN') return 'HIDDEN'

  const form = ctx.formMode === 'VIEW' ? 'VIEW' : 'EDIT'
  return lower(lower(grant, ancestor), form)
}

/**
 * The top level has no ancestor and therefore defaults to EDIT. An unknown
 * ancestor mode fails closed instead of guessing.
 *
 * @param {{ ancestorMode?: string }|null|undefined} scope
 */
export function ancestorMode(scope) {
  if (!scope) return 'EDIT'
  const mode = scope.ancestorMode ?? 'EDIT'
  return mode in RANK ? mode : 'HIDDEN'
}

/**
 * Decide what a mode toggle should do before FormHost mutates any state.
 *
 * Only a move to VIEW can discard drafts, and only after the warning returns
 * truthy. The warning is never consulted for a same-mode click, a clean form or
 * a move back to EDIT.
 *
 * @param {{ next: 'EDIT'|'VIEW', mode: 'EDIT'|'VIEW', dirty?: boolean, complexDirty?: boolean, warn?: () => boolean }} options
 * @returns {{ apply: boolean, reset: boolean }}
 */
export function planModeChange({
  next,
  mode,
  dirty = false,
  complexDirty = false,
  warn,
} = {}) {
  if (next === mode) return { apply: false, reset: false }

  const isDirty = Boolean(dirty || complexDirty)

  if (next === 'VIEW' && isDirty) {
    const proceed = typeof warn === 'function' ? warn() : true
    if (!proceed) return { apply: false, reset: false }
    return { apply: true, reset: true }
  }

  return { apply: true, reset: false }
}

/**
 * Resolve every field once for a values snapshot, including template children
 * under their group's effective mode.
 *
 * @param {object} document
 * @param {unknown} values
 * @param {object} ctx
 * @returns {Map<string, 'HIDDEN'|'VIEW'|'EDIT'>}
 */
export function computeModes(document, values, ctx = {}) {
  const modes = new Map()
  const getValues = () => values
  const forcedHidden = document.forcedHidden ?? new Set()
  const baseVisibility = ctx.visibility
  const visibility = (fieldId, getValues, nestedCtx) =>
    forcedHidden.has(fieldId) ||
    (typeof baseVisibility === 'function'
      ? Boolean(baseVisibility(fieldId, getValues, nestedCtx))
      : Boolean(baseVisibility?.has?.(fieldId)))

  const effectiveCtx = { ...ctx, visibility }

  for (const def of document.fields ?? []) {
    const mode = resolveMode(def, getValues, null, effectiveCtx)
    modes.set(def.id, mode)

    if (!def.isRepeat || !Array.isArray(def.template)) continue

    const groupSegments = scopeSegments({
      segments: def.binding?.value?.segments,
    })
    const scope = {
      segments: [...groupSegments, '*'],
      index: null,
      key: null,
      ancestorMode: mode,
    }

    for (const child of def.template) {
      modes.set(child.id, resolveMode(child, getValues, scope, effectiveCtx))
    }
  }

  return modes
}
