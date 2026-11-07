/**
 * In-module cascade sources. The demo makes no network requests: each source is
 * a deterministic mock with a small latency and abort support.
 *
 * A source receives only the paths declared by the cascade effect. It must never
 * read the whole form, and it never receives a URL.
 */

export const SOURCE_LATENCY_MS = 120

const abortError = () => {
  if (typeof DOMException === 'function') {
    return new DOMException('The operation was aborted.', 'AbortError')
  }
  const error = new Error('The operation was aborted.')
  error.name = 'AbortError'
  return error
}

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError())
      return
    }

    let timer
    const onAbort = () => {
      clearTimeout(timer)
      reject(abortError())
    }

    timer = setTimeout(() => {
      signal?.removeEventListener?.('abort', onAbort)
      resolve()
    }, ms)

    signal?.addEventListener?.('abort', onAbort, { once: true })
  })
}

const readString = (value) =>
  typeof value === 'string' ? value.trim() : ''

const label = (value) => {
  const text = readString(value).toUpperCase()
  return text === '' ? 'UNKNOWN' : text.slice(0, 12)
}

/**
 * Deterministic policy code for the declared `country` param. Extra params are
 * ignored by construction.
 *
 * @param {{ country?: unknown }} [params]
 * @param {{ signal?: AbortSignal }} [options]
 */
export async function policyCode(params = {}, { signal } = {}) {
  const country = label(params?.country)
  await wait(SOURCE_LATENCY_MS, signal)
  return country === 'UNKNOWN' ? 'POLICY-UNKNOWN' : `${country}-POLICY-001`
}

/**
 * Deterministic region description for the declared `country` and `region`
 * params.
 *
 * @param {{ country?: unknown, region?: unknown }} [params]
 * @param {{ signal?: AbortSignal }} [options]
 */
export async function regionInfo(params = {}, { signal } = {}) {
  const country = label(params?.country)
  const region = label(params?.region)
  await wait(SOURCE_LATENCY_MS, signal)
  return `${country}-${region}-REGION`
}

/** Registry object consumed by `parseDocument({ sources })` and `FormHost`. */
export const SOURCES = {
  policyCode,
  regionInfo,
}
