# Review — related-asset fetching (final)

## Key concerns

| Tag | Concern |
|---|---|
| `[server]` | server state — baseline, cache, refetch, invalidation |
| `[dirty]` | working/dirty state — editable copy, isDirty, reset |
| `[commit]` | commit semantics — submit vs on-change, write-if-dirty, upsert |
| `[unique]` | per-type unique logic — relationType + shape |
| `[compose]` | composition — array of types -> map of results |
| `[deps]` | cross-asset dependency — License requires Attachment |
| `[OCP]` | extension — add a new type without editing the core |
| `[render]` | re-render granularity — one type updating does not re-render all |

## How we got here

- **v1** — options A/B/C: one mechanism tried to solve four concerns at once.
- **v2** — split server-state from composition; dropped B; added D/E/F.
- **v3** — added the change/write flow (working/dirty/commit); RTK Query mandated;
  added upsert + cardinality.

## Final verdict

| Option | Verdict |
|---|---|
| A — logic-only components | Same controller problems as F + null-return plumbing. Reject. |
| C — provider + registry | Same problems + redundant hand-rolled cache + re-render granularity. Reject. |
| D — RTK Query + registry | Correct `[server]` foundation. Use as the base of F, not alone. |
| E — dep-free controller | Moot: RTK Query already mandated. Reject. |
| F — field controller + RTK Query + registry | Winner, re-scoped (see `design-human.md` / `design-agent.md`). |

## Synthesis

A, C and F are one family — a per-type **controller** plus a **registry** — differing
only in how the controller is hosted (headless component / context / hook). The hosting
mechanism is minor; the controller contract is the real decision.

## Final answer

**F, re-scoped**: RTK Query (baseline + tags) + a thin `useAssetCore` (baseline + upsert
+ remove) + a per-type module that owns its own shape (single / list / read-only) and
upsert. Full design: `design-human.md` (agent spec: `design-agent.md`, verify: `verify-guide.md`).

## Open decisions

1. **Working-state placement** — local `useState` vs Redux slice.
2. **List write semantics** — sequential mutations (no transaction); remove = unlink vs delete asset.
3. **Real API reconciliation** — endpoint names, 1..1 return shape (array vs object); via `verify-guide.md`.

## Next step

Prototype one single-shape (License) + one many-shape (Comment History) + one dependent
pair (License -> Attachment) to validate the module contract and upsert.
