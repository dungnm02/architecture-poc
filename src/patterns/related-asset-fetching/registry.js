const modules = new Map()

export function registerAssetModule(module) {
  const { type, relationType, useController } = module ?? {}
  if (!type || !relationType) throw new Error('asset module needs a type and a relationType')
  if (typeof useController !== 'function') throw new Error(`asset module ${type} needs a useController`)
  if (modules.has(type)) throw new Error(`duplicate asset type: ${type}`)
  modules.set(type, module)
  return module
}

export function getAssetModule(type) {
  const module = modules.get(type)
  if (!module) throw new Error(`unknown asset type: ${type}`)
  return module
}

export function registeredTypes() {
  return [...modules.keys()]
}

// Deterministic topological order. Input order is kept unless a `requires` edge says otherwise.
// A `requires` entry that is not part of `types` is ignored: the dependency is simply not composed.
export function orderByRequires(types) {
  if (new Set(types).size !== types.length) throw new Error(`duplicate types in request: ${types.join(', ')}`)

  const requested = new Set(types)
  for (const type of types) getAssetModule(type) // fail fast on unknown types

  const ordered = []
  const placed = new Set()
  const pending = [...types]

  while (pending.length > 0) {
    const index = pending.findIndex((type) =>
      (getAssetModule(type).requires ?? []).every((dep) => !requested.has(dep) || placed.has(dep)),
    )
    if (index === -1) throw new Error(`requires cycle among: ${pending.join(', ')}`)
    const [type] = pending.splice(index, 1)
    placed.add(type)
    ordered.push(type)
  }

  return ordered
}
