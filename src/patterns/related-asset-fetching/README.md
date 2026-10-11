# PoC — related-asset fetching (option F)

Runnable prototype of the design in `problems/related-asset-fetching/`
(`design-human.md`, `design-agent.md`). `npm run dev`, then open the app.

## What it shows

A subject screen declares four supporting-asset types and gets four controllers back:

```jsx
const { REMARK, COMMENT_HISTORY, ATTACHMENT, LICENSE } =
  useRelatedAssets('dataset-1', ['REMARK', 'LICENSE', 'COMMENT_HISTORY', 'ATTACHMENT'])
```

- **REMARK** — `single` shape (editable text, saved on submit).
- **COMMENT_HISTORY** — `many` shape (add / edit / remove, diff-saved).
- **ATTACHMENT** — `readonly` shape (listed, never edited here).
- **LICENSE** — `single`, `requires: ['ATTACHMENT']`; its controller reads the sibling
  from `ctx.deps` (the business rule "no license without an attachment").

The panel at the bottom lists every backend call, so the two-phase read, the two-phase
write and the rollback are visible. Tick **fail relation writes** to watch the rollback: a
*new* asset is deleted when `ensureRelation` fails, an *existing* one is kept (invariant 4).
Switch the subject to see that tags do not leak across subjects.

## Files

| File | Role |
|---|---|
| `mock-backend.js` | in-memory RELATION + ASSET endpoints, call log, failure injection |
| `api.js` | RTK Query `createApi` (read / upsert / remove) + tags |
| `registry.js` | `registerAssetModule`, `orderByRequires` |
| `useAssetCore.js` | one core per type: baseline + upsert/remove + status |
| `useRelatedAssets.js` | two-pass composition: cores, then controllers |
| `diffLists.js` | `many`-shape diff (`added` / `updated` / `removed` / `isDirty`) |
| `modules/*.js` | one module per type; new type = new file + one import |
| `store.js` | Redux store, registers the modules |
| `RelatedAssetsDemo.jsx` | the consumer (UI) |

`npm run test` runs the `diffLists` self-check.

## Known gap — re-render granularity

Acceptance criterion "one type updating does not re-render every consumer" is **not** met
by the straightforward composition. `useRelatedAssets` subscribes to all four types inside
one component, so any baseline change re-renders that component and every panel below it.
React DevTools Profiler shows it plainly.

Two ways to fix, both a consumer-side decision, not a core change:

1. Call `useRelatedAssets` once per panel in the panel's own component (each subscribes to
   one type). Cheapest, but gives up the single "declare the types" call.
2. Memoize each controller in the core (`useMemo` per type) and wrap panels in `React.memo`.
   Keeps the single call, but every module must also return a stable object.

## Deviations from `design-agent.md`

- Files live under `src/patterns/related-asset-fetching/`, not `src/assets/`, because
  `src/assets/` is Vite's static-asset folder and this repo keeps demos under
  `src/patterns/<name>/`.
- `ctx` is rebuilt every render (it must carry a fresh `baseline` and `deps`), so it is not
  identity-stable. Modules must not `useEffect(..., [ctx])`.
- `remove` only unlinks the relation (invariant 11); the asset row is left in place.
- A `requires` entry that the consumer did not also request is ignored.
