/**
 * Form-level registry for complex fields.
 *
 * Complex fields are not part of `properties` or RHF values, so their handles
 * live here, keyed by field id. Registration is idempotent across StrictMode's
 * effect/cleanup/effect cycle: re-registering replaces by id and a cleanup only
 * removes the exact handle instance it registered.
 *
 * No React or RHF imports: the registry is a plain Map wrapper and is testable
 * under `node --test`.
 *
 * @typedef {Object} ComplexHandle
 * @property {() => Promise<Array<{ fieldId: string, message: string }>>} validate
 * @property {(entity: object) => Promise<{ ok: boolean }>} submit
 * @property {() => boolean} isDirty
 */

export function createComplexRegistry() {
  const handles = new Map()

  const registry = {
    /**
     * Register a handle by field id. A later registration for the same id wins;
     * the returned cleanup is a no-op if the handle has already been replaced.
     *
     * @param {string} fieldId
     * @param {ComplexHandle} handle
     * @returns {() => void}
     */
    register(fieldId, handle) {
      if (typeof fieldId !== 'string' || fieldId === '' || !handle) {
        return () => {}
      }

      handles.set(fieldId, handle)

      return () => {
        if (handles.get(fieldId) === handle) handles.delete(fieldId)
      }
    },

    /**
     * Remove a handle only when it is still the registered instance. Calling
     * this with a stale handle never removes its replacement.
     */
    unregister(fieldId, handle) {
      if (handles.get(fieldId) === handle) handles.delete(fieldId)
    },

    get(fieldId) {
      return handles.get(fieldId)
    },

    /** Handles in registration order. Callers iterate a snapshot. */
    values() {
      return [...handles.values()]
    },

    isDirty() {
      for (const handle of handles.values()) {
        if (handle.isDirty()) return true
      }
      return false
    },

    clear() {
      handles.clear()
    },

    get size() {
      return handles.size
    },
  }

  return registry
}
