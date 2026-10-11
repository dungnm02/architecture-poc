# Problem: related-asset fetching

Shared fetch/create over a dynamic Asset + Relation model.

Handoff statement. Goal: pick an architecture that makes per-supporting-asset
fetching/creating reusable while each asset keeps its own business logic.

## Domain

- **Subject types**, same business level: ASSET, ACTIVITY, ASSET REVIEW.
  - ASSET is dynamic: main (Dataset, Model) and supporting (Remark, Comment History,
    Attachment, License, ...). Supporting assets are Assets too — fewer properties,
    same shared create endpoint.
- **Relation**: typed directed edge `source(subject) -> target(asset)`, named
  `has` + asset name (`hasRemark`, `hasAttachment`, ...). Cardinality varies (1..1,
  1..n, ...).
- ACTIVITY and REVIEW consume supporting assets through the same relation plumbing.

## The reusable core (this is what repeats)

Reading one supporting asset is **two-phase**:

1. call RELATION by relation type -> returns target ids
2. call ASSET GET to hydrate ids

ASSET GET supports batching, but only within one asset type. So no cross-type batch.
N relation types = N relation calls + N asset calls (today 10 types, +5 per year
planned).

Writing one supporting asset is **two-phase with rollback**:

1. upsert Asset (shared endpoint - create when new, update when it already exists)
2. ensure Relation (source = subject, target = asset; create if missing)
Rollback logic is extensive (step 2 failure must undo step 1, etc.).

## Consumer requirement

A subject screen needs several supporting assets at once (e.g. Dataset wants
Remark + Comment History + License). Today it must call one hook per asset
(`useRemark`, `useCommentHistory`, ...), each repeating the two-phase core, plus
coordinate cross-asset business rules. Wanted: consumer *declares* what it needs;
shared core lives once. The declared set is an array of type names; the mechanism returns a map keyed by type, each entry carrying that type data and logic: useRelatedAssets([REMARK, COMMENT]) -> { REMARK: {...}, COMMENT: {...} }.


## Change / write requirement

A supporting asset is not just read once. It appears in two write contexts:

1. **Form field.** The value is edited inside a form. On change it is stored in
   *separate* state (kept out of the main object, because it is special). On submit,
   the form checks whether the value actually changed (to avoid wasted API calls) and
   only then writes.
2. **Standalone.** The asset is not in a form but still relates to the subject. Any
   change writes immediately via API.

The shared core must therefore expose, per supporting asset type:
- a **working value** and a **change handler** (`setValue` / `onChange`)
- **dirty tracking** (working value vs fetched baseline) and **reset**
- a **commit/save** action that runs the two-phase write only when dirty
- two commit modes: **on-submit** (form) and **on-change** (standalone, immediate)
The working value's shape varies by cardinality: a single value (1..1, e.g. License) or a list (1..n, e.g. Comment History). The shared core must not assume one shape.

## Extension requirement

Per-asset unique logic is business-dependent and **not yet enumerable** (mid-migration
from an old project to the Asset concept). The design must accept new asset types and
new unique behaviors without editing the shared core.

## Cross-asset coordination requirement

Supporting assets depend on each other per senior-defined business/design rules.
Example today: `useDataset` composes `useLicense` + `useAttachment` and has custom
functions/useEffect that coordinate the relationship. Depth up to 3 expected, common
for Attachment; deeper allowed later. Coordination rules are business logic, not
generic — but the mechanism must not fight them.

## Constraints

- Plain React, no SSR. Hooks-first: the controller is a hook (`useController`).
- RTK Query + Redux are the mandated data/server-state layers (no TanStack Query).
- RELATION read is strictly per relation type; no all-types-in-one-call endpoint.
- ASSET GET batch is same-type only.
- Fetch must be exposed so the parent can decide when to refetch.
- Eager-vs-lazy fetch: undecided, to be chosen after a draft.
- Mount independence: wanted for perf, but unresolved (only helps if it gates lazy fetch).

## Options already on the table

- **A — logic-only (headless) components**: one component holds the shared core; one child per
  supporting asset; child is logic-only (renders `null`); its hooks expose data + actions to the container. Keeps hooks. Weakness:
  hides children from the consumer, so cross-asset coordination (License needs
  Attachment) gets hard.
- **C — Provider + registry**: Context provides the shared core; each asset type
  registers its unique logic in a map; consumer reads by name. Shared logic once,
  unique logic per registration.
- **D — server-state library + module registry**: RTK Query (already in the project)
  owns fetch/cache/refetch; a registry of per-type modules plus per-type query hooks compose
  the declared array into a map. See `analysis-option-d.md`.
- **E — dep-free generic hook + module cache**: same shape as F without a dependency;
  hand-rolls a small module-level cache. See `analysis-option-e.md`.
- **F - field controller + server-state library + registry** (recommended): adds a generic `useAssetField` (value / setValue / isDirty / reset / save) for the change/write flow on top of D, using RTK Query + Redux (zero new deps). See `analysis-option-f.md`.

## Open decisions for the analyzing model

1. Which option (or hybrid) satisfies all three: hook-friendliness, cross-asset
   coordination, open-ended per-asset extension?
2. Eager vs lazy fetch, and whether mount independence is required for either.
3. Where cross-asset coordination rules live: consumer, asset registration, or a
   dedicated layer.
4. How to model depth-3 nesting without special-casing it.
5. Shape of the write core so the two-step + rollback is reusable and testable.
6. Upsert semantics: how the write core tells create from update, and how it knows whether the asset already exists.
7. Controller contract per cardinality: single value (1..1) vs list (1..n) vs read-only.

## Analysis (per option)

- [Option A — logic-only components](analysis-option-a.md)
- [Option C — Provider + registry](analysis-option-c.md)
- [Option D - server-state library + module registry](analysis-option-d.md)
- [Option E - dep-free hook + module cache](analysis-option-e.md)
- [Option F - field controller + server-state library + registry](analysis-option-f.md)
- [Comparison](comparison.md)
- [Review - final analysis](review.md)
- [Design - human](design-human.md)
- [Design - agent spec](design-agent.md)
- [Verify guide](verify-guide.md)


