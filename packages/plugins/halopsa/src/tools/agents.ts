import { defineTool, type ToolDef } from '@conduit-mcp/plugin-sdk'
import { getClient } from '../client.js'
import { tagList } from '../settings.js'

// section names from the serviceTeams setting, empty = no section filter
function sectionFilter(serviceTeams: unknown): string {
  const names = tagList(serviceTeams)
  if (names.length === 0) {
    return ''
  }
  const list = names.map((n) => `'${n.replace(/'/g, "''")}'`).join(',')
  return `AND u.Usection IN (${list})`
}

export const agentTools: ToolDef[] = [
  defineTool({
    name: 'halopsa_agent_availability',
    description:
      'List agents who are currently out of office. Shows agent names and whether they\'re out via realtime status or a scheduled absence/appointment. Use this when asked "who\'s out", "who\'s off today", "who\'s sick", "who\'s on PTO", team availability, or similar staffing questions.',
    keywords: ['halopsa', 'agent', 'availability', 'out of office', 'staffing', 'pto', 'vacation', 'sick', 'absence'],
    params: {},
    readOnly: true,
    handler: async (_params, ctx) => {
      const client = await getClient(ctx)
      const cfg = await ctx.getConfig<{ serviceTeams?: string | string[] }>()
      const result = (await client.executeQuery(`
        SELECT u.Uname, u.Usection,
          CASE
            WHEN u.Utechstatus = 2 THEN 'Status: Out of Office'
            ELSE 'Scheduled Absence'
          END as reason
        FROM Uname u
        WHERE u.Uisdisabled = 0
          ${sectionFilter(cfg.serviceTeams)}
          AND (
            u.Utechstatus = 2
            OR u.Unum IN (
              SELECT DISTINCT a.APunum FROM APPOINTMENT a
              WHERE a.apagentstatus = 2
                AND a.APStartDate <= GETDATE()
                AND a.APEndDate >= GETDATE()
            )
          )
      `)) as { report?: { rows?: unknown[] } }

      const rows = (result?.report?.rows || []) as unknown[]
      if (rows.length === 0) {
        return { message: 'No agents are currently out of office.', agents: [] }
      }
      return { agents: rows, count: rows.length }
    },
  }),
]
