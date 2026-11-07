/**
 * Engine issues are the only diagnostics channel the pure engine uses.
 * `blocking` issues disable submit and are shown in the form banner; `warning`
 * issues are diagnostics only. No module is allowed to treat console output as
 * policy.
 */

const DETAIL_KEYS = new Set(['fieldId', 'ruleId'])

/**
 * @param {string} code
 * @param {'blocking'|'warning'} [severity]
 * @param {Record<string, unknown>|unknown} [detail]
 * @returns {{ code: string, severity: 'blocking'|'warning', fieldId?: string, ruleId?: string, detail?: unknown }}
 */
export function createIssue(code, severity = 'blocking', detail = {}) {
  const issue = { code, severity }

  if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
    const rest = {}
    for (const [key, value] of Object.entries(detail)) {
      if (DETAIL_KEYS.has(key)) {
        if (value !== undefined) issue[key] = value
      } else {
        rest[key] = value
      }
    }
    if (Object.keys(rest).length > 0) issue.detail = rest
  } else if (detail !== undefined && detail !== null) {
    issue.detail = detail
  }

  return issue
}

/** @param {Array<{ severity?: string }>} issues */
export function hasBlocking(issues) {
  return issues.some((issue) => issue.severity === 'blocking')
}

/** @param {Array<{ severity?: string }>} issues */
export function blockingIssues(issues) {
  return issues.filter((issue) => issue.severity === 'blocking')
}

const DEFAULT_LABEL = 'This field'

const MESSAGES = {
  internal: () => 'Something went wrong. Please try again.',
  required: (label) => `${label} is required.`,
  type: (label) => `${label} has an invalid type.`,
  enum: (label) => `${label} has an invalid value.`,
  const: (label) => `${label} has an invalid value.`,
  pattern: (label) => `${label} has an invalid format.`,
  minLength: (label, params) =>
    params?.limit === undefined
      ? `${label} is too short.`
      : `${label} must be at least ${params.limit} characters.`,
  maxLength: (label, params) =>
    params?.limit === undefined
      ? `${label} is too long.`
      : `${label} must be at most ${params.limit} characters.`,
  minimum: (label, params) =>
    params?.limit === undefined
      ? `${label} is too small.`
      : `${label} must be at least ${params.limit}.`,
  maximum: (label, params) =>
    params?.limit === undefined
      ? `${label} is too large.`
      : `${label} must be at most ${params.limit}.`,
  exclusiveMinimum: (label, params) =>
    params?.limit === undefined
      ? `${label} is too small.`
      : `${label} must be greater than ${params.limit}.`,
  exclusiveMaximum: (label, params) =>
    params?.limit === undefined
      ? `${label} is too large.`
      : `${label} must be less than ${params.limit}.`,
  multipleOf: (label) => `${label} is not a valid value.`,
  minItems: (label, params) =>
    params?.limit === undefined
      ? `${label} needs at least one item.`
      : `${label} needs at least ${params.limit} items.`,
  maxItems: (label, params) =>
    params?.limit === undefined
      ? `${label} has too many items.`
      : `${label} may have at most ${params.limit} items.`,
  additionalProperties: (label) => `${label} has an unknown field.`,
  uniqueItems: (label) => `${label} must not contain duplicates.`,
  root: () => 'The form is invalid. Please review the highlighted fields.',
}

/**
 * Frontend-owned wording. Never echo a regex, enum member, instance path or
 * JSON Pointer. Limits are safe to show because they are not document data.
 *
 * @param {string|{ keyword?: string, code?: string, params?: Record<string, any> }} error
 * @param {string} [label]
 */
export function messageFor(error, label) {
  const keyword =
    typeof error === 'string' ? error : error?.code ?? error?.keyword ?? 'root'
  const safeLabel =
    typeof label === 'string' && label.trim() !== '' ? label.trim() : DEFAULT_LABEL
  const params =
    typeof error === 'object' && error !== null ? error.params : undefined
  const build = MESSAGES[keyword]

  if (!build) {
    return keyword === 'root'
      ? MESSAGES.root(safeLabel)
      : `${safeLabel} is invalid.`
  }

  return build(safeLabel, params)
}
