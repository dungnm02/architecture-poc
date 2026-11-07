import { useFormState } from 'react-hook-form'
import { getAtSegments, toName } from '../engine/paths.js'
import { useFormEngine } from './useFormEngine.js'

/**
 * Group-level error surface. A repeat group's `minItems` violation maps to the
 * array path (`properties.participants`), not to a row leaf, so `useSlot` can
 * never show it. This subscription is scoped to that one name; it deliberately
 * does not read the whole `errors` object.
 *
 * @param {string[]} segments absolute group segments
 * @returns {string|undefined}
 */
export function useArrayError(segments) {
  const { control } = useFormEngine()
  const { errors } = useFormState({ control, name: toName(segments) })
  return getAtSegments(errors, segments)?.message
}
