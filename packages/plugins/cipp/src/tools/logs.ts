import { defineTool, trimResponse, z, type ToolDef } from '@conduit-mcp/plugin-sdk'
import { getClient } from '../client.js'
import {
  formatCippResult,
  AUDIT_LOG_FIELDS,
  MESSAGE_TRACE_FIELDS,
  MFA_USER_FIELDS,
  SIGNIN_LOG_FIELDS,
} from '../fields.js'

// graph auditLogRecord shape (security/auditLog/queries/{id}/records), differs from the
// directoryAudit shape AUDIT_LOG_FIELDS covers, auditData carries the full record detail
const AUDIT_RECORD_FIELDS = [
  'createdDateTime',
  'operation',
  'auditLogRecordType',
  'service',
  'userPrincipalName',
  'userType',
  'clientIp',
  'objectId',
  'auditData',
] as const

export const logTools: ToolDef[] = [
  defineTool({
    name: 'cipp_list_signin_logs',
    description:
      'List Entra (Azure AD) sign-in logs for a single user via CIPP. Returns up to 50 sign-in events with timestamp, app, IP address, location, client app, status, conditional access result, and risk level; covers successful and failed logins. userId accepts an object ID (GUID) or UPN; a UPN is resolved to its GUID first. tenantFilter is the tenant domain, e.g. contoso.onmicrosoft.com.',
    keywords: ['cipp', 'signin', 'sign-in', 'login', 'logs', 'user', 'entra', 'azure ad', 'm365', 'authentication'],
    params: {
      tenantFilter: z.string().describe('Tenant domain (e.g. contoso.onmicrosoft.com)'),
      userId: z.string().describe('Azure AD user ID (GUID) or UPN'),
    },
    readOnly: true,
    handler: async (params, ctx) => {
      const client = await getClient(ctx)
      const result = await client.listUserSigninLogs(params)
      return formatCippResult(result, SIGNIN_LOG_FIELDS)
    },
  }),

  defineTool({
    name: 'cipp_list_audit_logs',
    description:
      'List M365 audit log entries for a tenant via CIPP (admin actions, file access, mailbox changes). Optional startDate/endDate (ISO 8601) bound the range. Returns up to 50 entries with timestamp, activity, actor, target resources, and result. cipp_search_audit_logs runs an on-demand search with a time window instead.',
    keywords: ['cipp', 'audit', 'logs', 'm365', 'activity', 'admin actions', 'compliance'],
    params: {
      tenantFilter: z.string().describe('Tenant domain (e.g. contoso.onmicrosoft.com)'),
      startDate: z.string().optional().describe('Start date (ISO 8601)'),
      endDate: z.string().optional().describe('End date (ISO 8601)'),
    },
    readOnly: true,
    handler: async (params, ctx) => {
      const client = await getClient(ctx)
      const result = await client.listAuditLogs({
        tenantFilter: params.tenantFilter,
        StartDate: params.startDate,
        EndDate: params.endDate,
      })
      return formatCippResult(result, AUDIT_LOG_FIELDS)
    },
  }),

  defineTool({
    name: 'cipp_search_audit_logs',
    description:
      'Search the M365 unified audit log for a tenant via CIPP (ExecAuditLogSearch). Two-step and asynchronous: without searchId, submits a search over the startTime..endTime window (both required, ISO 8601) and returns a searchId; the search runs server-side, typically for minutes. Call again with that searchId to fetch matched records; empty results can mean the search has not finished, retry later. cipp_list_audit_logs is a synchronous date-bounded listing instead.',
    keywords: ['cipp', 'audit', 'logs', 'search', 'm365', 'unified audit log'],
    params: {
      tenantFilter: z.string().describe('Tenant domain (e.g. contoso.onmicrosoft.com)'),
      startTime: z.string().optional().describe('Start time (ISO 8601), required when submitting a search'),
      endTime: z.string().optional().describe('End time (ISO 8601), required when submitting a search'),
      searchId: z.string().optional().describe('Search id from a prior submit, fetches its results'),
    },
    readOnly: true,
    handler: async (params, ctx) => {
      const client = await getClient(ctx)
      if (params.searchId) {
        const result = await client.getAuditLogSearchResults({
          tenantFilter: params.tenantFilter,
          searchId: params.searchId,
        })
        return formatCippResult(result, AUDIT_RECORD_FIELDS)
      }
      if (!params.startTime || !params.endTime) {
        throw new Error('startTime and endTime are required to submit an audit log search')
      }
      const receipt = (await client.searchAuditLogs({
        tenantFilter: params.tenantFilter,
        StartTime: params.startTime,
        EndTime: params.endTime,
      })) as Record<string, unknown> | null
      const details = receipt?.details as Record<string, unknown> | undefined
      if (details?.id) {
        return {
          searchId: details.id,
          status: details.status,
          message: receipt?.resultText,
        }
      }
      // no id means submit failed or auditing disabled, surface the receipt as-is
      return trimResponse(receipt)
    },
  }),

  defineTool({
    name: 'cipp_list_message_trace',
    description:
      'Trace email messages through Exchange Online for a tenant via CIPP. sender and recipient filters are both optional; days sets the lookback window (default 10). Returns up to 50 messages with received time, sender, recipient, subject, delivery status, size, and message IDs.',
    keywords: ['cipp', 'message trace', 'email', 'mail flow', 'delivery', 'exchange', 'undelivered', 'm365'],
    params: {
      tenantFilter: z.string().describe('Tenant domain (e.g. contoso.onmicrosoft.com)'),
      sender: z.string().optional().describe('Sender email address'),
      recipient: z.string().optional().describe('Recipient email address'),
      days: z.number().optional().describe('Number of days to look back (default 10)'),
    },
    readOnly: true,
    handler: async (params, ctx) => {
      const client = await getClient(ctx)
      const result = await client.listMessageTrace(params)
      return formatCippResult(result, MESSAGE_TRACE_FIELDS)
    },
  }),

  defineTool({
    name: 'cipp_list_ca_policies',
    description:
      'List all Conditional Access policies for a tenant via CIPP. Returns up to 50 full policy objects: display name, state (enabled, disabled, report-only), conditions, and grant/session controls. For the policies that apply to one specific user, use cipp_list_user_ca_policies.',
    keywords: ['cipp', 'conditional access', 'ca policies', 'entra', 'azure ad', 'mfa', 'security policy', 'm365'],
    params: {
      tenantFilter: z.string().describe('Tenant domain (e.g. contoso.onmicrosoft.com)'),
    },
    readOnly: true,
    handler: async (params, ctx) => {
      const client = await getClient(ctx)
      const result = await client.listConditionalAccessPolicies(params)
      return formatCippResult(result)
    },
  }),

  defineTool({
    name: 'cipp_list_user_ca_policies',
    description:
      'List the Conditional Access policies that apply to a specific user via CIPP. userId accepts an object ID (GUID) or UPN; a UPN is resolved to its GUID first. Use cipp_list_ca_policies for every policy in the tenant.',
    keywords: ['cipp', 'conditional access', 'ca policies', 'user', 'entra', 'azure ad', 'mfa'],
    params: {
      tenantFilter: z.string().describe('Tenant domain (e.g. contoso.onmicrosoft.com)'),
      userId: z.string().describe('Azure AD user ID (GUID) or UPN'),
    },
    readOnly: true,
    handler: async (params, ctx) => {
      const client = await getClient(ctx)
      const result = await client.listUserConditionalAccessPolicies(params)
      return formatCippResult(result)
    },
  }),

  defineTool({
    name: 'cipp_list_mfa_users',
    description:
      'List MFA registration status for all users in a tenant via CIPP. Returns up to 50 users with registered authentication methods, per-user MFA state, conditional access and security defaults coverage, admin roles, and account status. Disabled accounts are excluded unless includeDisabled is true.',
    keywords: [
      'cipp',
      'mfa',
      'users',
      'authentication',
      'multifactor',
      '2fa',
      'registration',
      'entra',
      'm365',
      'security defaults',
    ],
    params: {
      tenantFilter: z.string().describe('Tenant domain (e.g. contoso.onmicrosoft.com)'),
      includeDisabled: z.boolean().optional().describe('Include disabled accounts (default: false)'),
    },
    readOnly: true,
    handler: async (params, ctx) => {
      const client = await getClient(ctx)
      const result = await client.listMFAUsers(params)
      return formatCippResult(result, MFA_USER_FIELDS)
    },
  }),

  defineTool({
    name: 'cipp_domain_health',
    description:
      'Run SPF, DKIM, DMARC, and MX checks for a domain in one call via CIPP. Returns one result per check keyed by check name (ReadSpfRecord, ReadDkimRecord, ReadDmarcPolicy, ReadMxRecord); a check that fails reports an error under its key instead of failing the call. Works for any domain and needs no tenantFilter. DNSSEC and MTA-STS are not included; use cipp_check_dnssec and cipp_check_mtasts.',
    keywords: [
      'cipp',
      'domain health',
      'spf',
      'dkim',
      'dmarc',
      'mx',
      'email security',
      'deliverability',
      'dns',
      'email authentication',
    ],
    params: {
      domain: z.string().describe('Domain to check (e.g. contoso.com)'),
    },
    readOnly: true,
    handler: async (params, ctx) => {
      const client = await getClient(ctx)
      const result = await client.getDomainHealthFull(params.domain)
      return trimResponse(result)
    },
  }),

  defineTool({
    name: 'cipp_check_spf',
    description:
      'Check the SPF record for a domain via CIPP. Returns the record, DNS lookup count, included IPs, detected mail provider, and recommendations. Works for any domain and needs no tenantFilter.',
    keywords: ['cipp', 'spf', 'sender policy framework', 'domain', 'dns', 'email security', 'deliverability'],
    params: {
      domain: z.string().describe('Domain to check (e.g. contoso.com)'),
    },
    readOnly: true,
    handler: async (params, ctx) => {
      const client = await getClient(ctx)
      const result = await client.getDomainHealth({ domain: params.domain, action: 'ReadSpfRecord' })
      return trimResponse(result)
    },
  }),

  defineTool({
    name: 'cipp_check_dkim',
    description:
      'Check DKIM records for a domain via CIPP. Returns public key info and validation status per selector. If selector is omitted, CIPP picks selectors from the detected mail provider (selector1/selector2 for Microsoft 365). Works for any domain and needs no tenantFilter.',
    keywords: ['cipp', 'dkim', 'selector', 'domain', 'dns', 'email security', 'email authentication'],
    params: {
      domain: z.string().describe('Domain to check (e.g. contoso.com)'),
      selector: z.string().optional().describe('DKIM selector to check (default: auto-detected from mail provider)'),
    },
    readOnly: true,
    handler: async (params, ctx) => {
      const client = await getClient(ctx)
      const result = await client.getDomainHealth({
        domain: params.domain,
        action: 'ReadDkimRecord',
        selector: params.selector,
      })
      return trimResponse(result)
    },
  }),

  defineTool({
    name: 'cipp_check_dmarc',
    description:
      'Check the DMARC policy for a domain via CIPP. Returns the policy, alignment settings, reporting addresses, and validation status. Works for any domain and needs no tenantFilter.',
    keywords: ['cipp', 'dmarc', 'domain', 'dns', 'email security', 'email authentication', 'spoofing'],
    params: {
      domain: z.string().describe('Domain to check (e.g. contoso.com)'),
    },
    readOnly: true,
    handler: async (params, ctx) => {
      const client = await getClient(ctx)
      const result = await client.getDomainHealth({ domain: params.domain, action: 'ReadDmarcPolicy' })
      return trimResponse(result)
    },
  }),

  defineTool({
    name: 'cipp_check_mx',
    description:
      'Check MX records for a domain via CIPP. Returns mail exchangers with priority and the detected mail provider. Works for any domain and needs no tenantFilter.',
    keywords: ['cipp', 'mx', 'mail exchanger', 'domain', 'dns', 'email security', 'mail routing'],
    params: {
      domain: z.string().describe('Domain to check (e.g. contoso.com)'),
    },
    readOnly: true,
    handler: async (params, ctx) => {
      const client = await getClient(ctx)
      const result = await client.getDomainHealth({ domain: params.domain, action: 'ReadMxRecord' })
      return trimResponse(result)
    },
  }),

  defineTool({
    name: 'cipp_check_dnssec',
    description:
      'Check DNSSEC validation for a domain via CIPP. Returns validation status and messages. Works for any domain and needs no tenantFilter. Not covered by cipp_domain_health.',
    keywords: ['cipp', 'dnssec', 'dns', 'dns security', 'domain', 'signing'],
    params: {
      domain: z.string().describe('Domain to check (e.g. contoso.com)'),
    },
    readOnly: true,
    handler: async (params, ctx) => {
      const client = await getClient(ctx)
      const result = await client.getDomainHealth({ domain: params.domain, action: 'TestDNSSEC' })
      return trimResponse(result)
    },
  }),

  defineTool({
    name: 'cipp_check_mtasts',
    description:
      'Check the MTA-STS policy for a domain via CIPP. MTA-STS enforces TLS on inbound mail delivery. Returns the policy and validation status. Works for any domain and needs no tenantFilter. Not covered by cipp_domain_health.',
    keywords: ['cipp', 'mta-sts', 'tls', 'domain', 'email security', 'mail transport'],
    params: {
      domain: z.string().describe('Domain to check (e.g. contoso.com)'),
    },
    readOnly: true,
    handler: async (params, ctx) => {
      const client = await getClient(ctx)
      const result = await client.getDomainHealth({ domain: params.domain, action: 'TestMtaSts' })
      return trimResponse(result)
    },
  }),
]
