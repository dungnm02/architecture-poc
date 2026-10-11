import { useCallback } from 'react'
import {
  useGetRelatedAssetQuery,
  useUpsertRelatedAssetMutation,
  useRemoveRelatedAssetMutation,
} from './api'
import { getAssetModule } from './registry'

// One core per type: the RTK Query subscription plus the two write actions.
// It never learns what the type means - the module does that.
export function useAssetCore(type, subjectId, { skip = false } = {}) {
  const module = getAssetModule(type)
  const enabled = subjectId != null && !skip

  const query = useGetRelatedAssetQuery(
    { subjectId, type, relationType: module.relationType },
    { skip: !enabled },
  )
  const [upsertRelatedAsset, upsertResult] = useUpsertRelatedAssetMutation()
  const [removeRelatedAsset, removeResult] = useRemoveRelatedAssetMutation()

  const upsert = useCallback(
    (value, assetId) =>
      upsertRelatedAsset({
        subjectId,
        type,
        relationType: module.relationType,
        value,
        assetId,
      }).unwrap(),
    [upsertRelatedAsset, subjectId, type, module.relationType],
  )

  const remove = useCallback(
    (assetId) =>
      removeRelatedAsset({
        subjectId,
        type,
        relationType: module.relationType,
        assetId,
      }).unwrap(),
    [removeRelatedAsset, subjectId, type, module.relationType],
  )

  return {
    // null means "not loaded yet" - the dependency gate relies on exactly this
    baseline: query.data ?? null,
    refetch: query.refetch,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error ?? null,
    upsert,
    remove,
    upsertState: { isLoading: upsertResult.isLoading, error: upsertResult.error ?? null },
    removeState: { isLoading: removeResult.isLoading, error: removeResult.error ?? null },
  }
}
