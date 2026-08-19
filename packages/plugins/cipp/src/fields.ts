import { trimResponse } from '@conduit-mcp/plugin-sdk'

// cipp proxies microsoft graph, raw responses carry many nested objects. these lists keep
// only the fields useful for ai consumption

export const SIGNIN_LOG_FIELDS = [
  'createdDateTime',
  'userPrincipalName',
  'userDisplayName',
  'appDisplayName',
  'ipAddress',
  'clientAppUsed',
  'location',
  'status',
  'conditionalAccessStatus',
  'riskLevelAggregated',
  'riskState',
  'isInteractive',
  'resourceDisplayName',
] as const

export const AUDIT_LOG_FIELDS = [
  'createdDateTime',
  'CIPPAction',
  'activityDisplayName',
  'operationType',
  'result',
  'resultReason',
  'initiatedBy',
  'targetResources',
  'loggedByService',
  'category',
  'Tenant',
  'Title',
  'Data',
  'Actor',
  'IPAddress',
  'ResultStatus',
] as const

export const MESSAGE_TRACE_FIELDS = [
  'Received',
  'SenderAddress',
  'RecipientAddress',
  'Subject',
  'Status',
  'Size',
  'MessageId',
  'MessageTraceId',
  'FromIP',
  'ToIP',
] as const

export const MFA_USER_FIELDS = [
  'UPN',
  'UserPrincipalName',
  'AccountEnabled',
  'PerUser',
  'MFARegistration',
  'CoveredByCA',
  'CoveredBySD',
  'MemberOf',
  'AdminRoles',
  'MethodsRegistered',
  'displayName',
  'userType',
] as const

const DEFAULT_MAX_ITEMS = 50

export function pickFields<T extends Record<string, unknown>>(obj: T, fields: readonly string[]): Partial<T> {
  const result: Record<string, unknown> = {}
  for (const key of fields) {
    if (key in obj) {
      result[key] = obj[key]
    }
  }
  return result as Partial<T>
}

// slice an array result, pick fields, return the trimmed value. handles both raw arrays and
// objects wrapping a list under a Results/value key
export function formatCippResult(result: unknown, fields?: readonly string[], maxItems = DEFAULT_MAX_ITEMS): unknown {
  let items: Record<string, unknown>[] | null = null
  if (Array.isArray(result)) {
    items = result
  } else if (result && typeof result === 'object') {
    const obj = result as Record<string, unknown>
    const arrayKey = Object.keys(obj).find((k) => Array.isArray(obj[k]))
    if (arrayKey) {
      items = obj[arrayKey] as Record<string, unknown>[]
    }
  }

  if (items) {
    const totalItems = items.length
    if (fields) {
      items = items.map((item) => pickFields(item, fields) as Record<string, unknown>)
    }
    const truncated = items.length > maxItems
    if (truncated) {
      items = items.slice(0, maxItems)
    }
    const output = {
      returned: items.length,
      ...(truncated && { total: totalItems, truncated: true }),
      items,
    }
    return trimResponse(output, totalItems)
  }

  // non-array response (single object, domain health, etc.), pass through
  return trimResponse(result)
}
