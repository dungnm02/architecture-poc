import { useCallback, useState } from 'react'

// single (1..1): one editable text value, saved on submit.
// The draft is derived state - `draft === null` means "show the server value". There is no
// effect and no touched flag: a server value only shows while there is no draft, so a
// refetch can never clobber an in-flight edit.
function useController(ctx) {
  const { baseline, upsert, upsertState } = ctx
  const current = baseline?.[0] ?? null
  const serverText = current?.text ?? ''

  const [draft, setDraft] = useState(null)
  const value = draft ?? serverText
  const isDirty = value !== serverText

  const save = useCallback(async () => {
    if (!isDirty) return null // no-op when clean
    return upsert({ text: value }, current?.id)
  }, [isDirty, value, upsert, current?.id])

  const reset = useCallback(() => setDraft(null), [])
  const change = useCallback((next) => setDraft(next), [])

  return {
    value,
    setValue: change,
    isDirty,
    save,
    reset,
    saving: upsertState.isLoading,
    error: upsertState.error?.error ?? null,
  }
}

export const remark = {
  type: 'REMARK',
  relationType: 'hasRemark',
  useController,
}

export default remark
