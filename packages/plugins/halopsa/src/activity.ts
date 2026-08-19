// compiles the "active entity" rules into sql fragments + predicates, used by
// active-lists.ts to filter list_clients/list_users/list_contracts/list_recurring_invoices
// to the entities an MSP actually cares about by default. client type terms come from the
// clientTypeIncludes/clientTypeExcludes plugin settings, the rest are fixed defaults

import { tagList } from './settings.js'

export const CONTRACT_STATUS_LIVE = 3
export const CONTRACT_STATUS_EXPIRED = 4

export interface ClientActivityConfig {
  typeIncludes: string[]
  typeExcludes: string[]
  excludeInactiveFlag: boolean
}

export interface UserActivityConfig {
  excludeInactive: boolean
  excludeServiceAccounts: boolean
}

export interface RecurringInvoiceActivityConfig {
  excludeDisabled: boolean
}

export interface HaloActivitySettings {
  clientTypeIncludes?: unknown
  clientTypeExcludes?: unknown
}

export function clientActivityFromConfig(cfg: HaloActivitySettings): ClientActivityConfig {
  return {
    typeIncludes: tagList(cfg.clientTypeIncludes),
    typeExcludes: tagList(cfg.clientTypeExcludes),
    excludeInactiveFlag: true,
  }
}

export const DEFAULT_USER_ACTIVITY: UserActivityConfig = {
  excludeInactive: true,
  excludeServiceAccounts: true,
}

export const DEFAULT_RECURRING_INVOICE_ACTIVITY: RecurringInvoiceActivityConfig = {
  excludeDisabled: true,
}

function sqlLiteral(token: string): string {
  return token.toLowerCase().replace(/'/g, "''")
}

export function clientActivity(cfg: ClientActivityConfig): {
  sqlWhere: string
  usesTypeField: boolean
  describe(): string
} {
  const includes = cfg.typeIncludes.filter((t) => t.trim().length > 0)
  const excludes = cfg.typeExcludes.filter((t) => t.trim().length > 0)
  const parts: string[] = []
  if (includes.length > 0) {
    parts.push('(' + includes.map((t) => `LOWER(CFType) LIKE '%${sqlLiteral(t)}%'`).join(' OR ') + ')')
  }
  for (const t of excludes) {
    parts.push(`LOWER(CFType) NOT LIKE '%${sqlLiteral(t)}%'`)
  }
  if (cfg.excludeInactiveFlag) {
    parts.push('Aisinactive = 0')
  }
  return {
    sqlWhere: parts.length > 0 ? parts.join(' AND ') : '1 = 1',
    usesTypeField: includes.length > 0 || excludes.length > 0,
    describe: () => {
      const bits: string[] = []
      if (includes.length > 0) {
        bits.push(`type contains ${includes.map((t) => `'${t.toLowerCase()}'`).join(' or ')}`)
      }
      if (excludes.length > 0) {
        bits.push(excludes.map((t) => `not '${t.toLowerCase()}'`).join(', '))
      }
      if (cfg.excludeInactiveFlag) {
        bits.push('not flagged inactive')
      }
      return bits.join(', ') || 'all clients'
    },
  }
}

export function userActivity(cfg: UserActivityConfig): {
  sqlWhere: string
  predicate(item: Record<string, unknown>): boolean
  describe(): string
} {
  const parts: string[] = []
  if (cfg.excludeInactive) {
    parts.push('uinactive = 0')
  }
  if (cfg.excludeServiceAccounts) {
    parts.push('uisserviceaccount = 0')
  }
  return {
    sqlWhere: parts.length > 0 ? parts.join(' AND ') : '1 = 1',
    predicate: (item) => {
      if (cfg.excludeInactive && item.inactive === true) {
        return false
      }
      if (cfg.excludeServiceAccounts && item.isserviceaccount === true) {
        return false
      }
      return true
    },
    describe: () => {
      const bits: string[] = []
      if (cfg.excludeInactive) {
        bits.push('not inactive')
      }
      if (cfg.excludeServiceAccounts) {
        bits.push('not a service account')
      }
      return bits.join(', ') || 'all users'
    },
  }
}

export function contractIsLive(item: Record<string, unknown>): boolean {
  if (item.status !== undefined && item.status !== null) {
    return Number(item.status) === CONTRACT_STATUS_LIVE
  }
  return item.contract_status === 'Live'
}

export function contractDescribe(): string {
  return 'Active=Yes and Status=Live; expired-but-active counted in expired_awaiting_action (use include_inactive to list them), deactivated hidden (archive)'
}

export function recurringInvoiceActivity(cfg: RecurringInvoiceActivityConfig): {
  predicate(item: Record<string, unknown>): boolean
  describe(): string
} {
  return {
    predicate: (item) => {
      if (cfg.excludeDisabled && item.disabled === true) {
        return false
      }
      return true
    },
    describe: () => (cfg.excludeDisabled ? 'not disabled' : 'all recurring invoices'),
  }
}

// appended to halopsa_query's static description, so the client line describes the mechanism
// only; the per-instance terms surface as active_rule in halopsa_list_clients responses
export function activityGuidance(): string {
  const users = userActivity(DEFAULT_USER_ACTIVITY)
  return [
    '## Active-entity rules (configured)',
    `- Active clients: Aisinactive = 0 on Area, plus LOWER(CFType) LIKE include/exclude terms when the plugin's client type settings are set (CFType is a custom field, absent on stock instances). halopsa_list_clients returns the effective rule as active_rule`,
    `- Active end users: ${users.describe()} -> SQL: ${users.sqlWhere} (on Users; uisserviceaccount inflates counts if ignored)`,
    `- Active contracts (aka agreements, ConnectWise vocabulary): chactive = 1 AND CHstatus = ${CONTRACT_STATUS_LIVE} on CONTRACTHEADER; CHstatus ${CONTRACT_STATUS_EXPIRED} = expired, chactive = 0 = archived`,
    `- Active recurring invoices: ${recurringInvoiceActivity(DEFAULT_RECURRING_INVOICE_ACTIVITY).describe()}`,
  ].join('\n')
}
