import { useMemo } from 'react'
import { getAssetModule, orderByRequires } from './registry'
import { useAssetCore } from './useAssetCore'

// The consumer declares types, gets a map of controllers.
// `types` is a stable SET with a deterministic order: the two loops below always run the
// same number of hooks in the same order (invariant 7).
export function useRelatedAssets(subjectId, types, opts) {
  const ordered = useMemo(() => orderByRequires(types), [types])

  // Pass 1 - one core per type. `ordered` is topological, so a dependency's core already
  // exists by the time its dependent is built; the dependent is skipped while a required
  // sibling has not loaded yet.
  const cores = {}
  for (const type of ordered) {
    const required = (getAssetModule(type).requires ?? []).filter((dep) => cores[dep])
    const waiting = required.some((dep) => cores[dep].baseline === null)
    // eslint-disable-next-line react-hooks/rules-of-hooks -- fixed-length loop over a stable set
    cores[type] = useAssetCore(type, subjectId, { skip: waiting })
  }

  // Pass 2 - hand each module its ctx, after every core hook has run.
  const controllers = {}
  for (const type of ordered) {
    const module = getAssetModule(type)
    const deps = {}
    for (const dep of module.requires ?? []) if (controllers[dep]) deps[dep] = controllers[dep]

    // ctx is rebuilt each render on purpose: it must carry the fresh baseline and deps.
    // Modules must not depend on ctx identity (no `useEffect(..., [ctx])`).
    const ctx = { ...cores[type], subjectId, type, opts, deps }
    controllers[type] = module.useController(ctx)
  }

  return controllers
}
