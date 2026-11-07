import { createIssue } from './issues.js'
import {
  SEGMENT,
  INDEX,
  RESERVED,
  pathKey,
} from './paths.js'

/**
 * Closed condition language. JSON Logic is deliberately not used: the
 * evaluator is small enough to review, and unknown operators fail closed.
 */
export const OPERATORS = new Set([
  'eq',
  'neq',
  'in',
  'notIn',
  'gt',
  'gte',
  'lt',
  'lte',
  'empty',
  'and',
  'or',
  'not',
])

export const MAX_DEPTH = 8
export const MAX_NODES = 64

const COMPARISON = new Set(['eq', 'neq', 'gt', 'gte', 'lt', 'lte'])
const CONTAINMENT = new Set(['in', 'notIn'])
const BOOLEAN_GROUP = new Set(['and', 'or'])

const UNSAFE = /[.[\]'"~/]/

const isPlainObject = (value) =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

function normalisePath(rawPath) {
  let segments

  if (Array.isArray(rawPath)) {
    if (rawPath.length === 0) return null
    segments = [...rawPath]
  } else if (typeof rawPath === 'string') {
    if (rawPath === '') return null
    segments = rawPath.split('.')
  } else {
    return null
  }

  for (const segment of segments) {
    if (typeof segment !== 'string' || segment === '') return null
    if (segment === '*') continue
    if (RESERVED.has(segment)) return null
    if (INDEX.test(segment)) continue
    if (/^\d+$/.test(segment)) return null
    if (!SEGMENT.test(segment) || UNSAFE.test(segment)) return null
  }

  return segments
}

function resolveSegments(segments, resolvePath, scopePrefix) {
  if (typeof resolvePath !== 'function' && segments.includes('*')) return null

  const tryResolve = (candidate) => {
    if (typeof resolvePath !== 'function') {
      return { ok: true, segments: candidate }
    }
    try {
      const resolved = resolvePath(candidate)
      if (resolved === true) return { ok: true, segments: candidate }
      if (resolved && resolved.ok) {
        return { ok: true, segments: resolved.segments ?? candidate }
      }
      return { ok: false }
    } catch {
      return { ok: false }
    }
  }

  const direct = tryResolve(segments)
  if (direct.ok) return direct.segments

  if (Array.isArray(scopePrefix) && scopePrefix.length > 0) {
    const relative = tryResolve([...scopePrefix, ...segments])
    if (relative.ok) return relative.segments
  }

  return null
}

/**
 * Validate and normalise a condition once, at document parse time.
 *
 * `resolvePath(segments)` is supplied by document parse; it proves the path is
 * a declared binding and that any `*` is a real template position. Relative
 * paths are retried under `scopePrefix` (a group template prefix).
 *
 * @param {unknown} raw
 * @param {{ resolvePath?: (segments: string[]) => { ok: boolean, segments?: string[] }, scopePrefix?: string[] }} [options]
 */
export function validateCondition(raw, options = {}) {
  const { resolvePath, scopePrefix } = options
  const issues = []
  const dependsOn = []
  const seen = new Set()
  let nodes = 0
  let aborted = false

  const addIssue = (code, detail) => {
    issues.push(createIssue(code, 'blocking', detail))
  }

  const addDependency = (segments) => {
    const key = pathKey(segments)
    if (seen.has(key)) return
    seen.add(key)
    dependsOn.push(segments)
  }

  const visit = (node, depth) => {
    if (aborted) return null

    nodes += 1
    if (nodes > MAX_NODES) {
      addIssue('condition.nodes', { max: MAX_NODES })
      aborted = true
      return null
    }
    if (depth > MAX_DEPTH) {
      addIssue('condition.depth', { max: MAX_DEPTH, depth })
      return null
    }
    if (!isPlainObject(node)) {
      addIssue('condition.shape', {})
      return null
    }

    const { op } = node
    if (typeof op !== 'string' || !OPERATORS.has(op)) {
      addIssue('condition.operator', { op })
      return null
    }

    if (BOOLEAN_GROUP.has(op)) {
      if (!Array.isArray(node.args) || node.args.length === 0) {
        addIssue('condition.args', { op })
        return null
      }
      const args = []
      for (const arg of node.args) {
        const child = visit(arg, depth + 1)
        if (!child) return null
        args.push(child)
      }
      return { op, args }
    }

    if (op === 'not') {
      if (!Array.isArray(node.args) || node.args.length !== 1) {
        addIssue('condition.arity', { op })
        return null
      }
      const child = visit(node.args[0], depth + 1)
      if (!child) return null
      return { op, args: [child] }
    }

    const parsedPath = normalisePath(node.path)
    if (!parsedPath) {
      addIssue('condition.path', { path: node.path })
      return null
    }

    const resolved = resolveSegments(parsedPath, resolvePath, scopePrefix)
    if (!resolved) {
      addIssue('condition.path', { path: node.path })
      return null
    }

    if (op === 'empty') {
      addDependency(resolved)
      return { op, path: resolved }
    }

    if (CONTAINMENT.has(op)) {
      if (!Array.isArray(node.value)) {
        addIssue('condition.value', { op })
        return null
      }
      addDependency(resolved)
      return { op, path: resolved, value: node.value }
    }

    if (COMPARISON.has(op)) {
      if (!Object.hasOwn(node, 'value')) {
        addIssue('condition.value', { op })
        return null
      }
      addDependency(resolved)
      return { op, path: resolved, value: node.value }
    }

    addIssue('condition.operator', { op })
    return null
  }

  const condition = visit(raw, 1)

  return {
    ok: issues.length === 0 && Boolean(condition),
    condition: issues.length === 0 ? condition : null,
    issues,
    dependsOn,
  }
}

/** @param {unknown} condition @returns {string[][]} */
export function collectPaths(condition) {
  if (!isPlainObject(condition)) return []

  const seen = new Set()
  const paths = []
  const add = (path) => {
    if (!Array.isArray(path) || path.length === 0) return
    const key = pathKey(path)
    if (seen.has(key)) return
    seen.add(key)
    paths.push([...path])
  }

  const walk = (node) => {
    if (!isPlainObject(node)) return
    if (Array.isArray(node.path)) add(node.path)
    if (Array.isArray(node.args)) {
      for (const arg of node.args) walk(arg)
    }
  }

  walk(condition)
  return paths
}

function readPath(values, segments, itemIndex) {
  let current = values
  for (const segment of segments) {
    const key = segment === '*' ? itemIndex : segment
    if (key === undefined || key === null) return undefined
    if (current === null || typeof current !== 'object') return undefined
    if (!Object.hasOwn(current, key)) return undefined
    current = current[key]
  }
  return current
}

const isEmpty = (value) =>
  value === undefined ||
  value === null ||
  value === '' ||
  (Array.isArray(value) && value.length === 0) ||
  (isPlainObject(value) && Object.keys(value).length === 0)

/**
 * Evaluate a validated condition against the live values object. Conditions
 * only read; they never write.
 *
 * @param {unknown} condition
 * @param {unknown} values
 * @param {{ itemIndex?: number }} [options]
 */
export function evaluate(condition, values, options = {}) {
  if (!isPlainObject(condition)) return false
  const { itemIndex } = options

  switch (condition.op) {
    case 'eq':
    case 'neq':
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      if (!Array.isArray(condition.path) || !Object.hasOwn(condition, 'value')) {
        return false
      }
      const actual = readPath(values, condition.path, itemIndex)
      const expected = condition.value
      switch (condition.op) {
        case 'eq':
          return actual === expected
        case 'neq':
          return actual !== expected
        case 'gt':
          return actual != null && expected != null && actual > expected
        case 'gte':
          return actual != null && expected != null && actual >= expected
        case 'lt':
          return actual != null && expected != null && actual < expected
        case 'lte':
          return actual != null && expected != null && actual <= expected
        default:
          return false
      }
    }
    case 'in':
      if (!Array.isArray(condition.path) || !Array.isArray(condition.value)) {
        return false
      }
      return condition.value.includes(readPath(values, condition.path, itemIndex))
    case 'notIn':
      if (!Array.isArray(condition.path) || !Array.isArray(condition.value)) {
        return false
      }
      return !condition.value.includes(readPath(values, condition.path, itemIndex))
    case 'empty':
      if (!Array.isArray(condition.path)) return false
      return isEmpty(readPath(values, condition.path, itemIndex))
    case 'and':
      if (!Array.isArray(condition.args) || condition.args.length === 0) {
        return false
      }
      return condition.args.every((arg) => evaluate(arg, values, options))
    case 'or':
      if (!Array.isArray(condition.args) || condition.args.length === 0) {
        return false
      }
      return condition.args.some((arg) => evaluate(arg, values, options))
    case 'not':
      if (!Array.isArray(condition.args) || condition.args.length !== 1) {
        return false
      }
      return !evaluate(condition.args[0], values, options)
    default:
      return false
  }
}
