import { defineTool, z, trimResponse, type ToolDef } from '@conduit-mcp/plugin-sdk'
import { getClient } from '../client.js'
import { writesEnabled } from './actions.js'

// halo write responses come back as an array, a bare object, or {tickets|actions: [...]}
function unwrapWrite(res: unknown, key: string): Record<string, unknown> {
  if (Array.isArray(res)) {
    return (res[0] ?? {}) as Record<string, unknown>
  }
  if (res && typeof res === 'object') {
    const nested = (res as Record<string, unknown>)[key]
    if (Array.isArray(nested)) {
      return (nested[0] ?? {}) as Record<string, unknown>
    }
    return res as Record<string, unknown>
  }
  return {}
}

export const ticketWriteTools: ToolDef[] = [
  defineTool({
    name: 'halopsa_create_ticket',
    description:
      'Create a new HaloPSA ticket against a client (and optionally a contact/site). Only use when the user has confirmed they want a ticket logged; do not auto-create on every mention of a problem. Returns the new ticket id and status.',
    keywords: ['halopsa', 'ticket', 'create', 'new', 'write'],
    params: {
      summary: z.string().describe('Short single-line ticket subject'),
      details: z.string().describe('Full ticket body; HTML accepted. Include context and error messages.'),
      client_id: z.number().describe('Client (company) ID the ticket belongs to (find via halopsa_list_clients)'),
      user_id: z.number().optional().describe('End user (contact) ID who reported the issue'),
      site_id: z.number().optional().describe('Site ID when the client has multiple locations'),
      tickettype_id: z.number().optional().describe('Ticket type ID; omit for the tenant default'),
      agent_id: z.number().optional().describe('Assign to this agent; omit for default routing'),
    },
    readOnly: false,
    handler: async (params, ctx) => {
      if (!(await writesEnabled(ctx))) {
        return { error: 'writes disabled, enable writesEnabled in halopsa plugin settings' }
      }
      const client = await getClient(ctx)
      const ticket = unwrapWrite(await client.createTicket(params), 'tickets')
      return trimResponse({
        id: ticket.id,
        summary: ticket.summary,
        status_id: ticket.status_id,
        status: ticket.status_name,
        client_id: ticket.client_id,
        user_id: ticket.user_id,
      })
    },
  }),

  defineTool({
    name: 'halopsa_add_crm_note',
    description:
      'Log a CRM note against a HaloPSA client, contact, or site (exactly one scope). For out-of-ticket activity: a discovery call, an account-management touch, a vendor update. For ticket work use halopsa_add_action instead.',
    keywords: ['halopsa', 'crm', 'note', 'client', 'log', 'write'],
    params: {
      subject: z.string().describe('Short note subject'),
      note: z.string().describe('Note body; HTML accepted'),
      client_id: z.number().optional().describe('Attach to this client (company)'),
      user_id: z.number().optional().describe('Attach to this end user (contact)'),
      site_id: z.number().optional().describe('Attach to this site'),
      timetaken: z.number().optional().describe('Time spent in decimal hours (0.25 = 15 minutes)'),
      hide_time_taken: z.boolean().optional().describe('Hide the recorded time from the customer'),
    },
    readOnly: false,
    handler: async (params, ctx) => {
      if (!(await writesEnabled(ctx))) {
        return { error: 'writes disabled, enable writesEnabled in halopsa plugin settings' }
      }
      const scopes = [params.client_id, params.user_id, params.site_id].filter((v) => v !== undefined)
      if (scopes.length !== 1) {
        return { error: 'Provide exactly one of client_id, user_id, or site_id.' }
      }
      const client = await getClient(ctx)
      const created = unwrapWrite(await client.createCrmNote(params), 'actions')
      return trimResponse({
        id: created.id,
        subject: created.subject,
        client_id: created.client_id,
        user_id: created.user_id,
        site_id: created.site_id,
        datetime: created.datetime,
      })
    },
  }),
]
