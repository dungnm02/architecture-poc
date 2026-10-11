# Option F — spec (for agents)

Machine-checkable contract. Feed this to an agent that implements or verifies the
design. Human rationale lives in `design-human.md`; this file is the precise shape.

## Scope & assumptions

- React 19, plain JS, RTK Query + Redux mandated, no TanStack, no SSR.
- Domain: subject (ASSET / ACTIVITY / ASSET_REVIEW) -> supporting asset via a typed
  relation named `has` + asset name.

## Vocabulary

- `type` — supporting-asset key, e.g. `'REMARK'`.
- `relationType` — relation edge label, e.g. `'hasRemark'`.
- `subjectId` — id of the subject the assets attach to.

## Module contract (exact)

`registerAssetModule(m)` where `m`:

```
{
  type: string,                        // required, unique
  relationType: string,                // required
  requires?: string[],                 // optional; registered types, acyclic, ordered before this type
  compare?: (a,b) => boolean,          // optional; default = shallow equality; REQUIRED for objects/lists
  useController: (ctx) => Controller,  // required; its return shape IS the shape (no enum)
}
```

No `cardinality` enum, no `validate` (future concern), and no `Component`/UI - strictly logic; the consumer renders the UI. The shape is whatever
`useController` returns. `baseline` is always the raw hydrated array (even for 1..1);
the module interprets it: `single` -> `baseline?.[0] ?? null`, `many` -> `baseline ?? []`.
`ctx` (stable across renders):

```
{ baseline, refetch, isLoading, error, upsert, remove, upsertState, removeState,
  subjectId, type, opts, deps }
```

`Controller` shapes (exact keys; no enum enforces them):

- single   -> `{ value, setValue, isDirty, save, reset }`
- many     -> `{ items, add, update, remove, isDirty, save }`
- readonly -> `{ data, refetch, isLoading, error }`

## RTK Query contract

`createApi({ reducerPath: 'assetApi', tagTypes: ['RelatedAsset'], endpoints })`:

- `getRelatedAsset.query({subjectId,type})`
  - two-phase: `relationApi.getRelations(subjectId, relationType)` then
    `assetApiClient.getAssets(type, ids)` (batched within type only; returns the raw array, the module shapes it).
  - `providesTags` -> `[{ type:'RelatedAsset', id: subjectId + ':' + type }]`.
- `upsertRelatedAsset.mutation({subjectId,type,value,assetId})`
  - `assetApiClient.upsertAsset(type, value, assetId)` (create-or-update).
  - `relationApi.ensureRelation(subjectId, id, relationType)` (create if missing).
  - on relation failure: `assetApiClient.deleteAsset(id)` ONLY if `assetId == null`.
  - `invalidatesTags` -> same tag id.
- `removeRelatedAsset.mutation({subjectId,type,assetId})`
  - `relationApi.deleteRelation(subjectId, assetId, relationType)`.
  - `invalidatesTags` -> same tag id.

## Hooks contract

- `useAssetCore(type, subjectId, { skip })`
  -> `{ baseline, refetch, isLoading, error, upsert, remove, upsertState, removeState }`.
  - skip the query when `subjectId == null || skip`.

- `useRelatedAssets(subjectId, types, opts)` -> `{ [type]: Controller }`.
  - `types`: stable SET and deterministic order (a fresh literal array is fine); never add/remove types between renders.
  - topologically sort by `requires` (deterministic; throw on cycle).
  - pass 1: `useAssetCore` per type; gate fetch (`skip`) while any required sibling's
    `baseline` is `null`.
  - pass 2: `module.useController` per type, passing resolved sibling controllers as `deps`.

## Invariants (must hold)

1. A module never calls the api/relation client directly; it only uses `ctx`.
2. `save()` no-ops when not dirty (`!isDirty`); `isDirty` compares the working value against the same extraction the shape uses (single: `baseline?.[0]`, many: the diff in 10).
3. `save()` uses upsert (create-or-update), never create-only.
4. Rollback deletes the asset only when newly created.
5. Tag id is always `subjectId + ':' + type`; every mutation invalidates its own tag.
6. Asset hydration batches within one type only; never cross-type.
7. Rules of hooks: loops over `types` are fixed and deterministic; `useController` makes
   no conditional hook calls.
8. Non-primitive values require `module.compare` (shallow default is not deep enough).
9. `many`-shape `save` diffs `items` vs `baseline`: removed -> `remove`, added -> `upsert`,
   changed -> `upsert`.
10. `many`-shape `isDirty` = diff non-empty (added/removed/changed); never reference equality on the `items` array.
11. `remove` unlinks (deleteRelation). Deleting the asset itself is a per-type decision.

## File layout

```
src/assets/
  api.js               # RTK Query endpoints
  registry.js          # assetModules map + registerAssetModule
  useAssetCore.js      # baseline + upsert/remove + status
  useRelatedAssets.js  # composition
  diffLists.js         # list-shape diff helper (shared)
  modules/
    remark.js
    comment-history.js
    license.js
    attachment.js
    index.js           # imports every module (registers them)
```

## Edge cases (must be handled)

- reset-on-load must not overwrite in-flight edits (track a `touched` flag or reset explicitly).
- list removals go through `removeRelation`, not `upsert`.
- auto-save: debounce + cancel in-flight mutation (no undefined last-write-wins).
- `requires` cycle -> throw at registration.
- duplicate `type` -> throw at registration.

## Acceptance criteria

- [ ] `useRelatedAssets(subjectId, types)` returns one controller per type, correct shape.
- [ ] New type = one module file + import; no core edit.
- [ ] Editing an existing asset updates it (no duplicate asset/relation).
- [ ] Relation failure rolls back only newly-created assets.
- [ ] Save is a no-op when the field is clean.
- [ ] A 1..n type (Comment History) supports add / update / remove with correct diff-save.
- [ ] A `requires` dependency (License -> Attachment) fetches and saves in the right order.
- [ ] One type updating does not re-render every consumer.
