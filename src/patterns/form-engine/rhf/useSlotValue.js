import { useWatch } from 'react-hook-form'
import { toName } from '../engine/paths.js'
import { useFormEngine } from './useFormEngine.js'

/**
 * Read-only subscription for VIEW renderers. One explicit name, never a whole
 * values subscription.
 *
 * @param {string[]} segments
 */
export function useSlotValue(segments) {
  const { control } = useFormEngine()
  return useWatch({ control, name: toName(segments) })
}
