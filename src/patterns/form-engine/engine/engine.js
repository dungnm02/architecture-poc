import { createCascadeState } from './cascades.js'
import { createResolver, createValidatorCache } from './validation.js'

/**
 * Composition root for the pure engine. It owns one validator cache and the
 * cascade state, and closes resolve over its live context provider.
 *
 * @param {{ document: object, getContext?: () => object, record?: (issue: object) => void, sources?: unknown }} options
 */
export function createEngine({ document, getContext, record, sources } = {}) {
  const cache = createValidatorCache({ max: 20 })
  const cascades = createCascadeState()

  let contextProvider =
    typeof getContext === 'function' ? getContext : () => ({})

  const engine = {
    document,
    record: typeof record === 'function' ? record : () => {},
    cascades,
    validatorFor(key, build) {
      return cache.validatorFor(key, build)
    },
    ctx() {
      const provided = contextProvider()
      return {
        ...(provided && typeof provided === 'object' ? provided : {}),
        document,
        sources,
        cascades,
      }
    },
    setContextProvider(provider) {
      contextProvider =
        typeof provider === 'function' ? provider : () => ({})
    },
    settleCascades(ms = 3000) {
      const tasks = [...cascades.tasks]
      if (tasks.length === 0) return Promise.resolve(true)

      return new Promise((resolve) => {
        let settled = false
        const finish = (value) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          resolve(value)
        }
        const timer = setTimeout(() => finish(false), ms)
        Promise.allSettled(tasks).then(() => finish(true))
      })
    },
  }

  engine.resolve = createResolver(engine)

  return engine
}
