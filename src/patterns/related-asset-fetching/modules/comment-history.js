import { useCallback, useMemo, useState } from 'react'
import { diffLists } from '../diffLists'

// many (1..n): a draft list, diff-saved - removed -> unlink, added/changed -> upsert.
// `draft === null` means "show the server list"; the first edit materialises the draft.
function useController(ctx) {
  const { baseline, refetch, upsert, remove: unlink, upsertState, removeState } = ctx
  const server = useMemo(() => baseline ?? [], [baseline])

  const [draft, setDraft] = useState(null)
  const items = draft ?? server

  const diff = useMemo(() => diffLists(items, server), [items, server])

  const edit = useCallback(
    (mutate) => setDraft((rows) => mutate((rows ?? server).map((row) => ({ ...row })))),
    [server],
  )
  const add = useCallback(() => edit((rows) => [...rows, { id: undefined, text: '' }]), [edit])
  const update = useCallback(
    (index, text) => edit((rows) => rows.map((row, i) => (i === index ? { ...row, text } : row))),
    [edit],
  )
  const remove = useCallback((index) => edit((rows) => rows.filter((_, i) => i !== index)), [edit])

  const save = useCallback(async () => {
    if (!diff.isDirty) return // no-op when clean
    // shortcut: N sequential mutations, no transaction; a mid-list failure leaves a partial save.
    for (const row of diff.removed) await unlink(row.id)
    for (const row of [...diff.added, ...diff.updated]) await upsert({ text: row.text }, row.id)
    // a new row only gets its id from the server, so drop the draft once the server is current
    await refetch()
    setDraft(null)
  }, [diff, unlink, upsert, refetch])

  return {
    items,
    add,
    update,
    remove,
    isDirty: diff.isDirty,
    save,
    saving: upsertState.isLoading || removeState.isLoading,
    error: upsertState.error?.error ?? removeState.error?.error ?? null,
  }
}

export const commentHistory = {
  type: 'COMMENT_HISTORY',
  relationType: 'hasCommentHistory',
  useController,
}

export default commentHistory
