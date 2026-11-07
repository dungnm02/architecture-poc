export { DOCUMENT, ENTITY } from './documents.js'

/**
 * Permission sets are rendering rules, not authorization. The server must omit
 * unauthorized values and enforce writes; this demo only chooses which renderer
 * a field gets.
 */
export const PERMISSION_SETS = [
  {
    id: 'editor',
    label: 'Editor — all fields EDIT',
    permissions: {
      country: 'EDIT',
      effectiveDate: 'EDIT',
      startDate: 'EDIT',
      endDate: 'EDIT',
      notes: 'EDIT',
      currency: 'EDIT',
      policyCode: 'EDIT',
      participants: 'EDIT',
      participantId: 'EDIT',
      participantName: 'EDIT',
      participantRole: 'EDIT',
      participantTaxId: 'EDIT',
      attachment: 'EDIT',
    },
  },
  {
    id: 'viewer',
    label: 'Viewer — all fields VIEW',
    permissions: {
      country: 'VIEW',
      effectiveDate: 'VIEW',
      startDate: 'VIEW',
      endDate: 'VIEW',
      notes: 'VIEW',
      currency: 'VIEW',
      policyCode: 'VIEW',
      participants: 'VIEW',
      participantId: 'VIEW',
      participantName: 'VIEW',
      participantRole: 'VIEW',
      participantTaxId: 'VIEW',
      attachment: 'VIEW',
    },
  },
]

const COUNTRY_REJECTED =
  'Country ZZ is not allowed by the server'

/**
 * Local, deterministic save mock. No network.
 *
 * A country of `ZZ` always fails with a path-level 422 so the demo can exercise
 * server-error mapping. `setFailNext(true)` makes the next save fail with the
 * same path error, which keeps the "simulate 422" control simple.
 */
export function createSaveEntity() {
  let failNext = false

  const saveEntity = async (payload) => {
    if (failNext) {
      failNext = false
      return {
        ok: false,
        errors: [
          {
            path: 'properties.policy.country',
            message: COUNTRY_REJECTED,
          },
        ],
      }
    }

    if (payload?.properties?.policy?.country === 'ZZ') {
      return {
        ok: false,
        errors: [
          {
            path: 'properties.policy.country',
            message: COUNTRY_REJECTED,
          },
        ],
      }
    }

    return {
      ok: true,
      value: structuredClone(payload),
    }
  }

  saveEntity.setFailNext = (value = true) => {
    failNext = Boolean(value)
  }
  saveEntity.failNext = () => {
    failNext = true
  }

  return saveEntity
}
