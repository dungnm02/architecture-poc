import { createContext, useContext } from 'react'

/**
 * Values that the React layer shares with every FieldHost and renderer. The
 * provider value is memoised in FormHost; an inline object would re-render every
 * consumer on every host render.
 */
export const FormEngineContext = createContext(null)

export function useFormEngine() {
  const context = useContext(FormEngineContext)
  if (!context) {
    throw new Error('useFormEngine must be used inside <FormHost>')
  }
  return context
}
