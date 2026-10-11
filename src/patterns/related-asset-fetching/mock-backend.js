// In-memory stand-in for the RELATION + ASSET endpoints. No network, no persistence.
// Every call is logged so the two-phase read/write and the rollback are visible in the UI.
// shortcut: single-process mock that resets on reload; swap for the real clients later.

let seq = 0
let assets = new Map() // id -> { id, type, ...value }
let relations = [] // { sourceId, targetId, relationType }
let callLog = []
let failRelations = false

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function log(entry) {
  callLog.push(entry)
  if (callLog.length > 120) callLog = callLog.slice(-120)
  return entry
}

export function getCallLog() {
  return callLog
}

export function setFailRelations(next) {
  failRelations = Boolean(next)
}

// --- RELATION ---

export async function getRelations(sourceId, relationType) {
  await wait(60)
  const ids = relations
    .filter((r) => r.sourceId === sourceId && r.relationType === relationType)
    .map((r) => r.targetId)
  log({ op: 'getRelations', sourceId, relationType, ids })
  return ids
}

export async function ensureRelation(sourceId, targetId, relationType) {
  await wait(120)
  if (failRelations) {
    log({ op: 'ensureRelation', sourceId, targetId, relationType, result: 'FAILED' })
    throw new Error('ensureRelation failed (injected)')
  }
  const exists = relations.some(
    (r) => r.sourceId === sourceId && r.targetId === targetId && r.relationType === relationType,
  )
  if (!exists) relations.push({ sourceId, targetId, relationType })
  log({ op: 'ensureRelation', sourceId, targetId, relationType, result: exists ? 'exists' : 'created' })
  return { created: !exists }
}

export async function deleteRelation(sourceId, targetId, relationType) {
  await wait(90)
  const index = relations.findIndex(
    (r) => r.sourceId === sourceId && r.targetId === targetId && r.relationType === relationType,
  )
  if (index !== -1) relations.splice(index, 1)
  log({ op: 'deleteRelation', sourceId, targetId, relationType, result: index === -1 ? 'missing' : 'deleted' })
}

// --- ASSET ---

export async function getAssets(type, ids) {
  await wait(90)
  const rows = ids.map((id) => assets.get(id)).filter((asset) => asset && asset.type === type)
  log({ op: 'getAssets', type, ids, count: rows.length })
  return rows.map((asset) => ({ ...asset }))
}

export async function upsertAsset(type, value, assetId) {
  await wait(120)
  if (assetId != null) {
    const existing = assets.get(assetId)
    if (!existing) throw new Error(`asset ${assetId} not found`)
    const next = { ...existing, ...value }
    assets.set(assetId, next)
    log({ op: 'upsertAsset', mode: 'update', id: assetId, type })
    return { ...next }
  }
  const id = `${type.toLowerCase()}-${++seq}`
  const created = { id, type, ...value }
  assets.set(id, created)
  log({ op: 'upsertAsset', mode: 'create', id, type })
  return { ...created }
}

export async function deleteAsset(id) {
  await wait(60)
  assets.delete(id)
  log({ op: 'deleteAsset', id })
}

// --- seed ---

function seedAsset(type, value) {
  const id = `${type.toLowerCase()}-${++seq}`
  const asset = { id, type, ...value }
  assets.set(id, asset)
  return asset
}

function seedRelation(sourceId, targetId, relationType) {
  relations.push({ sourceId, targetId, relationType })
}

export function seed() {
  assets = new Map()
  relations = []
  callLog = []
  failRelations = false
  seq = 0

  // dataset-1 owns a full set of supporting assets
  const remark = seedAsset('REMARK', { text: 'Primary dataset for the Q3 model.' })
  const commentA = seedAsset('COMMENT_HISTORY', { text: 'Backfill looks clean.' })
  const commentB = seedAsset('COMMENT_HISTORY', { text: 'Rows match the source of truth.' })
  const attachment = seedAsset('ATTACHMENT', { name: 'dataset-dictionary.xlsx' })
  const license = seedAsset('LICENSE', { key: 'CC-BY-4.0' })
  seedRelation('dataset-1', remark.id, 'hasRemark')
  seedRelation('dataset-1', commentA.id, 'hasCommentHistory')
  seedRelation('dataset-1', commentB.id, 'hasCommentHistory')
  seedRelation('dataset-1', attachment.id, 'hasAttachment')
  seedRelation('dataset-1', license.id, 'hasLicense')

  // model-1 is sparse: tags must not leak between subjects
  const modelRemark = seedAsset('REMARK', { text: 'Distilled from the base model.' })
  seedRelation('model-1', modelRemark.id, 'hasRemark')

  log({ op: 'seed', subjects: ['dataset-1', 'model-1'] })
}

// the mock database starts seeded so the demo has data on first paint
seed()
