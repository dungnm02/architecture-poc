import { useCallback, useState } from 'react'

// single (1..1) plus a cross-asset rule: a license may only be set once the subject has at
// least one attachment. The rule reads the sibling controller from `deps`, so the business
// logic stays in this module and never leaks into the core.
// Same derived-draft trick as `remark`: no effect, no clobber.
function useController(ctx) {
  const { baseline, upsert, upsertState, deps } = ctx
  const attachmentCount = deps.ATTACHMENT?.data?.length ?? 0

  const current = baseline?.[0] ?? null
  const serverKey = current?.key ?? ''

  const [draft, setDraft] = useState(null)
  const value = draft ?? serverKey
  const isDirty = value !== serverKey
  const blockedReason = attachmentCount === 0 ? 'Add an attachment first.' : null

  const save = useCallback(async () => {
    if (!isDirty || blockedReason) return null
    return upsert({ key: value }, current?.id)
  }, [isDirty, blockedReason, value, upsert, current?.id])

  const reset = useCallback(() => setDraft(null), [])
  const change = useCallback((next) => setDraft(next), [])

  return {
    value,
    setValue: change,
    isDirty,
    save,
    reset,
    blockedReason,
    saving: upsertState.isLoading,
    error: upsertState.error?.error ?? null,
  }
}

export const license = {
  type: 'LICENSE',
  relationType: 'hasLicense',
  requires: ['ATTACHMENT'],
  useController,
}

export default license
