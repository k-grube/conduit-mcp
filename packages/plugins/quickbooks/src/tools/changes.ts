import { defineTool, z, type ToolDef } from '@conduit-mcp/plugin-sdk'
import { getQboClient, isQboError, type QboErrorEnvelope } from '../client.js'

const CDC_NOTE = 'CDC: no user attribution, last 30 days only. Includes deletes.'
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000
const MAX_ENTITIES = 10
const NON_ENTITY_KEYS = new Set(['startPosition', 'maxResults', 'totalCount'])

interface CdcResponse {
  CDCResponse?: Array<{ QueryResponse?: Array<Record<string, unknown>> }>
  time?: string
}

// CDC returns CDCResponse[0].QueryResponse as a sparse positional array: each element is either
// {} or { <EntityName>: [...records], startPosition, maxResults }. Flatten to one object keyed by entity name.
function flattenCdc(raw: CdcResponse): Record<string, unknown[]> {
  const changes: Record<string, unknown[]> = {}
  const blocks = raw.CDCResponse?.[0]?.QueryResponse ?? []
  for (const block of blocks) {
    for (const [key, val] of Object.entries(block)) {
      if (NON_ENTITY_KEYS.has(key)) {
        continue
      }
      if (Array.isArray(val)) {
        changes[key] = val
      }
    }
  }
  return changes
}

export const changeTools: ToolDef[] = [
  defineTool({
    name: 'qbo_list_changes',
    description:
      'List QBO records created, updated, or deleted since a timestamp (Change Data Capture), a "what changed recently" feed for polling and sync. entities is 1-10 QBO entity names (e.g. Customer, Invoice, Account); changed_since is an ISO datetime within the last 30 days. Returns changes keyed by entity name; deletes are included. Limitations: no user attribution, 30-day window, no before/after diff. For a date-range register of financial transactions use qbo_list_transactions instead.',
    keywords: ['quickbooks', 'cdc', 'change data capture', 'sync', 'delta', 'modified', 'deleted', 'recent'],
    params: {
      entities: z.array(z.string()).describe('QBO entity names to watch, e.g. ["Customer","Invoice"] (1-10)'),
      changed_since: z.string().describe('ISO datetime, must be within the last 30 days'),
    },
    readOnly: true,
    handler: async (args, ctx) => {
      const entities = args.entities ?? []
      if (entities.length === 0) {
        const envelope: QboErrorEnvelope = {
          error: 'qbo_api_error',
          status: 400,
          code: 'invalid_request',
          detail: 'entities must be a non-empty array of QBO entity names',
        }
        return envelope
      }
      if (entities.length > MAX_ENTITIES) {
        const envelope: QboErrorEnvelope = {
          error: 'qbo_api_error',
          status: 400,
          code: 'invalid_request',
          detail: `entities is limited to ${MAX_ENTITIES} names per call`,
        }
        return envelope
      }
      if (!args.changed_since) {
        const envelope: QboErrorEnvelope = {
          error: 'qbo_api_error',
          status: 400,
          code: 'invalid_request',
          detail: 'changed_since is required (ISO datetime within the last 30 days)',
        }
        return envelope
      }
      const sinceMs = Date.parse(args.changed_since)
      if (Number.isNaN(sinceMs)) {
        const envelope: QboErrorEnvelope = {
          error: 'qbo_api_error',
          status: 400,
          code: 'invalid_request',
          detail: 'changed_since must be a valid ISO datetime',
        }
        return envelope
      }
      if (sinceMs > Date.now()) {
        const envelope: QboErrorEnvelope = {
          error: 'qbo_api_error',
          status: 400,
          code: 'invalid_request',
          detail: 'changed_since cannot be in the future',
        }
        return envelope
      }
      if (Date.now() - sinceMs > THIRTY_DAYS_MS) {
        const envelope: QboErrorEnvelope = {
          error: 'qbo_api_error',
          status: 400,
          code: 'cdc_window_too_large',
          detail: 'changed_since must be within the last 30 days; CDC does not return older changes',
        }
        return envelope
      }

      const client = await getQboClient(ctx)
      const result = await client.get<CdcResponse>('cdc', {
        entities: entities.join(','),
        changedSince: args.changed_since,
      })
      if (isQboError(result)) {
        return result
      }
      return { changes: flattenCdc(result), time: result.time ?? null, note: CDC_NOTE }
    },
  }),
]
