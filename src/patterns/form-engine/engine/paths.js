import { createIssue } from './issues.js'

/**
 * A binding segment is an object key. Arrays are addressed by canonical
 * indices only. Wildcards (`*`) are never valid parsePath segments: they belong
 * to template positions that document parse proves.
 */
export const SEGMENT = /^[A-Za-z_][A-Za-z0-9_-]*$/
export const INDEX = /^(0|[1-9]\d*)$/
export const RESERVED = new Set(['__proto__', 'prototype', 'constructor'])

const UNSAFE = /[.[\]'"~/]/

/** @param {unknown} segment */
export function isIndexSegment(segment) {
  return typeof segment === 'string' && INDEX.test(segment)
}

/**
 * Parse a document binding path exactly once. Numeric segments are accepted
 * here only in canonical form; document parse still has to prove the prefix is
 * a declared array position.
 *
 * @param {unknown} path
 * @returns {{ ok: true, segments: string[] } | { ok: false, issue: object }}
 */
export function parsePath(path) {
  if (typeof path !== 'string') {
    return {
      ok: false,
      issue: createIssue('path.type', 'blocking', { path }),
    }
  }
  if (path === '') {
    return {
      ok: false,
      issue: createIssue('path.empty', 'blocking', { path }),
    }
  }

  const segments = path.split('.')

  for (const segment of segments) {
    if (segment === '') {
      return {
        ok: false,
        issue: createIssue('path.segment', 'blocking', { path, segment }),
      }
    }
    if (RESERVED.has(segment)) {
      return {
        ok: false,
        issue: createIssue('path.reserved', 'blocking', { path, segment }),
      }
    }
    if (INDEX.test(segment)) continue
    if (/^\d+$/.test(segment)) {
      return {
        ok: false,
        issue: createIssue('path.index', 'blocking', { path, segment }),
      }
    }
    if (!SEGMENT.test(segment) || UNSAFE.test(segment)) {
      return {
        ok: false,
        issue: createIssue('path.unsafe', 'blocking', { path, segment }),
      }
    }
  }

  return { ok: true, segments }
}

/** @param {string[]} segments */
export function toName(segments) {
  return segments.reduce(
    (name, segment) =>
      INDEX.test(segment)
        ? `${name}[${segment}]`
        : name === ''
          ? segment
          : `${name}.${segment}`,
    '',
  )
}

/** Collision-free internal map key. */
export function pathKey(segments) {
  return segments.join('/')
}

/**
 * Decode a JSON Pointer into segments. AJV uses pointers; the engine stores
 * segment arrays.
 *
 * @param {string} pointer
 */
export function pointerToSegments(pointer) {
  if (typeof pointer !== 'string' || pointer === '' || pointer[0] !== '/') {
    return []
  }
  return pointer
    .slice(1)
    .split('/')
    .map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'))
}

/** @param {string[]} prefix @param {string[]} segments */
export function pathStartsWith(prefix, segments) {
  if (prefix.length > segments.length) return false
  return prefix.every((segment, index) => segments[index] === segment)
}

/**
 * Template paths use `*` for exactly one array index.
 *
 * @param {string[]} template
 * @param {string[]} concrete
 */
export function pathMatchesTemplate(template, concrete) {
  if (template.length !== concrete.length) return false
  return template.every((segment, index) =>
    segment === '*' ? INDEX.test(concrete[index]) : segment === concrete[index],
  )
}

/** @param {string[]} segments @param {number|string} index */
export function substituteIndex(segments, index) {
  return segments.map((segment) => (segment === '*' ? String(index) : segment))
}

/**
 * Read a value by segments from an already-built values object. Missing
 * branches, nulls and non-objects return `undefined`; this helper never throws.
 * It is used by slot type checks and the group-error subscription, where the
 * path can point at a row that has just been removed.
 *
 * @param {unknown} object
 * @param {string[]} segments
 */
export function getAtSegments(object, segments) {
  if (!Array.isArray(segments)) return undefined
  let current = object

  for (const segment of segments) {
    if (current === null || typeof current !== 'object') return undefined
    if (!Object.hasOwn(current, segment)) return undefined
    current = current[segment]
  }

  return current
}
