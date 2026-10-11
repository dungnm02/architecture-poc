import { createApi } from '@reduxjs/toolkit/query/react'
import * as backend from './mock-backend'

export const tagId = (subjectId, type) => `${subjectId}:${type}`

// No fetch base: every endpoint carries its own queryFn (the two-phase mock calls).
// When a real API arrives, replace the queryFn bodies with the HTTP clients; the tags stay.
export const assetApi = createApi({
  reducerPath: 'assetApi',
  tagTypes: ['RelatedAsset'],
  endpoints: (build) => ({
    // read: relation ids -> hydrate assets (batched within one type only)
    getRelatedAsset: build.query({
      async queryFn({ subjectId, relationType, type }) {
        try {
          const ids = await backend.getRelations(subjectId, relationType)
          const assets = await backend.getAssets(type, ids)
          return { data: assets }
        } catch (error) {
          return { error: { status: 'CUSTOM_ERROR', error: toMessage(error) } }
        }
      },
      providesTags: (_result, _error, { subjectId, type }) => [
        { type: 'RelatedAsset', id: tagId(subjectId, type) },
      ],
    }),

    // write: upsert asset -> ensure relation; roll back the asset only if this write created it
    upsertRelatedAsset: build.mutation({
      async queryFn({ subjectId, relationType, type, value, assetId }) {
        try {
          const asset = await backend.upsertAsset(type, value, assetId)
          try {
            await backend.ensureRelation(subjectId, asset.id, relationType)
          } catch (relationError) {
            if (assetId == null) await backend.deleteAsset(asset.id)
            return { error: { status: 'CUSTOM_ERROR', error: toMessage(relationError) } }
          }
          return { data: asset }
        } catch (error) {
          return { error: { status: 'CUSTOM_ERROR', error: toMessage(error) } }
        }
      },
      invalidatesTags: (_result, _error, { subjectId, type }) => [
        { type: 'RelatedAsset', id: tagId(subjectId, type) },
      ],
    }),

    // unlink the relation. Deleting the asset itself is a per-type decision (not done here).
    removeRelatedAsset: build.mutation({
      async queryFn({ subjectId, relationType, assetId }) {
        try {
          await backend.deleteRelation(subjectId, assetId, relationType)
          return { data: { id: assetId } }
        } catch (error) {
          return { error: { status: 'CUSTOM_ERROR', error: toMessage(error) } }
        }
      },
      invalidatesTags: (_result, _error, { subjectId, type }) => [
        { type: 'RelatedAsset', id: tagId(subjectId, type) },
      ],
    }),
  }),
})

function toMessage(error) {
  return String(error?.message ?? error)
}

export const {
  useGetRelatedAssetQuery,
  useUpsertRelatedAssetMutation,
  useRemoveRelatedAssetMutation,
} = assetApi
