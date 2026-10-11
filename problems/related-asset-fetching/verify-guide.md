# Verify guide — review the real codebase against the F spec

Give this guide + `design-agent.md` to an agent pointed at the real codebase. The agent
inspects and reports; it does NOT change code.

## Inputs the agent needs

1. `design-agent.md` — the contract to verify against.
2. This guide — the procedure and report format.
3. The codebase path.

## Step 1 — Map the current state (file:line table)

Locate and record:
- every `useRemark`, `useCommentHistory`, `useAttachment`, `useLicense` hook.
- every RELATION API call (`getRelations` / `createRelation` / `deleteRelation` / `ensureRelation`).
- every ASSET API call (`getAssets` / `createAsset` / `upsertAsset` / `deleteAsset`).
- every consumer (screen / form) that calls the above.

Output a table: hook -> relation calls -> asset calls -> consumers.

## Step 2 — Check each contract item

For every endpoint, hook, and invariant in `design-agent.md`, answer one of:
`implemented / partially / missing / diverges`. Then, specifically:

- Is the write **create-only** (missing update/upsert)?
- Is there **rollback**, and does it wrongly delete existing assets?
- Is there **dirty tracking** and **write-if-dirty**?
- Is **cardinality** modeled (single vs list), or does everything assume one value?
- Are **tags/invalidation** used, or is refetch manual?
- Do modules call the API **directly** (violating invariant 1)?

## Step 3 — Flag findings by severity

- **P1 (blocks adoption):** missing rollback, create-only save, wrong/missing tag
  invalidation, cross-type batch, rules-of-hooks violation.
- **P2 (fix before use):** no dirty tracking, no removeRelation for lists, reset-on-load
  race, no `compare` for object values.
- **P3 (nice-to-have):** central registry chokepoint, missing validation hook, duplicated
  two-phase logic per hook.

## Step 4 — Report format

One line per finding:

```
path:line — severity — problem. spec ref (endpoint/invariant #). fix.
```

Then two closing sections:
- **"Does the codebase support this design?"** — yes/partly/no, and what must change first.
- **"Where the spec itself is unproven"** — list-diff, `requires` gating, working-state in
  Redux; note whether the real code suggests a different answer.

## Step 5 — Search shortcuts

- relation calls: grep `getRelations|createRelation|deleteRelation`
- asset calls: grep `createAsset|upsertAsset|getAssets`
- repeated logic: grep `useRemark|useCommentHistory` and diff their bodies
- tags/invalidation: grep `providesTags|invalidatesTags|invalidate`
