import { useEffect } from 'react'
import { useFormEngine } from './useFormEngine.js'

/**
 * Register a complex-field handle at the form level.
 *
 * The effect depends on the exact handle instance. `createComplexRegistry`
 * replaces by field id and its cleanup removes only the same instance, so
 * StrictMode's effect → cleanup → effect cycle leaves one registration and a
 * replaced handle's stale cleanup cannot remove its successor.
 *
 * @param {string} fieldId
 * @param {object} handle
 */
export function useComplexHandle(fieldId, handle) {
  const { complex } = useFormEngine()

  useEffect(() => {
    if (!complex || !fieldId || !handle) return undefined
    return complex.register(fieldId, handle)
  }, [complex, fieldId, handle])
}
