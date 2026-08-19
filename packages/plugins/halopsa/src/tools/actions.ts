import { defineTool, z, stripHtml, type PluginContext, type ToolDef } from '@conduit-mcp/plugin-sdk'
import { getClient } from '../client.js'
import { ACTION_FIELDS } from '../fields.js'
import { formatListResult } from './format-result.js'

const stripActionHtml = (item: Record<string, unknown>) => {
  if (typeof item.note === 'string') {
    item.note = stripHtml(item.note)
  }
  return item
}

// halo rejects an action with no outcome (400 "An Outcome must be entered for this Action")
// Private Note is hidden from the end user and sends no email
const DEFAULT_OUTCOME = 'Private Note'

export const ADD_ACTION_DESCRIPTION =
  'Add a note/action to a HaloPSA ticket. Can include an outcome and optional status change. ' +
  `Defaults to the "${DEFAULT_OUTCOME}" outcome, which is internal-only; pass a different outcome to make the note visible to the end user.`

export interface AddActionArgs {
  ticket_id: number
  note: string
  outcome?: string
  outcome_id?: number
  new_status_id?: number
  timetaken?: number
  hidden_from_user?: boolean
}

export function buildActionPayload(args: AddActionArgs): Record<string, unknown> {
  const { note, outcome, outcome_id, new_status_id, timetaken, hidden_from_user } = args
  const action: Record<string, unknown> = { note, outcome: outcome ?? DEFAULT_OUTCOME }
  if (outcome_id) {
    action.outcome_id = outcome_id
  }
  if (new_status_id) {
    action.new_status_id = new_status_id
  }
  if (timetaken) {
    action.timetaken = timetaken
  }
  if (hidden_from_user !== undefined) {
    action.hiddenfromuser = hidden_from_user
  }
  return action
}

export async function writesEnabled(ctx: PluginContext): Promise<boolean> {
  const cfg = await ctx.getConfig<{ writesEnabled?: boolean }>()
  return cfg.writesEnabled === true
}

export const actionTools: ToolDef[] = [
  defineTool({
    name: 'halopsa_list_actions',
    description:
      'List actions on a HaloPSA ticket: notes, status changes, time entries, billable flags. Note HTML is stripped. Paginate with page_size/page_no for large tickets.',
    keywords: ['halopsa', 'action', 'note', 'comment', 'history', 'ticket', 'list'],
    params: {
      ticket_id: z.number().describe('The ticket ID to get actions for'),
      page_size: z.number().optional().default(25).describe('Results per page'),
      page_no: z.number().optional().default(1).describe('Page number'),
    },
    readOnly: true,
    handler: async (params, ctx) => {
      const client = await getClient(ctx)
      const { ticket_id, ...rest } = params
      const result = await client.getTicketActions(ticket_id, rest)
      return formatListResult(result, client, {
        collectionKey: 'actions',
        fields: ACTION_FIELDS,
        transformItem: stripActionHtml,
      })
    },
  }),

  defineTool({
    name: 'halopsa_add_action',
    description: ADD_ACTION_DESCRIPTION,
    keywords: ['halopsa', 'action', 'note', 'ticket', 'add', 'write'],
    params: {
      ticket_id: z.number().describe('The ticket ID to add the action to'),
      note: z.string().describe('The action note/comment text'),
      outcome: z
        .string()
        .optional()
        .describe(`Outcome name (use halopsa_get_outcomes to find valid names); defaults to "${DEFAULT_OUTCOME}"`),
      outcome_id: z.number().optional().describe('Outcome ID (use halopsa_get_outcomes to find valid IDs)'),
      new_status_id: z.number().optional().describe('Set ticket to this status after adding the action'),
      timetaken: z.number().optional().describe('Time taken in minutes'),
      hidden_from_user: z
        .boolean()
        .optional()
        .describe("Hide the note from the end user, overrides the outcome's default"),
    },
    readOnly: false,
    handler: async (params, ctx) => {
      if (!(await writesEnabled(ctx))) {
        return { error: 'writes disabled, enable writesEnabled in halopsa plugin settings' }
      }
      const { ticket_id, ...rest } = params
      const client = await getClient(ctx)
      return client.addTicketAction(ticket_id, buildActionPayload({ ticket_id, ...rest }))
    },
  }),

  defineTool({
    name: 'halopsa_get_outcomes',
    description:
      'List valid outcome types for ticket actions in HaloPSA. Use to find outcome names/IDs before halopsa_add_action.',
    keywords: ['halopsa', 'outcome', 'action', 'list'],
    params: {},
    readOnly: true,
    handler: async (_params, ctx) => {
      const client = await getClient(ctx)
      const result = await client.getOutcomes()
      return formatListResult(result, client)
    },
  }),

  defineTool({
    name: 'halopsa_get_statuses',
    description:
      'List all ticket status types in HaloPSA with their IDs and names. Use to resolve a status_id filter for halopsa_list_tickets.',
    keywords: ['halopsa', 'status', 'ticket', 'list'],
    params: {},
    readOnly: true,
    handler: async (_params, ctx) => {
      const client = await getClient(ctx)
      const result = await client.getStatuses()
      return formatListResult(result, client)
    },
  }),
]
