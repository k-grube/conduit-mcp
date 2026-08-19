import { defineTool, z, trimResponse, type ToolDef } from '@conduit-mcp/plugin-sdk'
import { getClient } from '../client.js'

export const tenantTools: ToolDef[] = [
  defineTool({
    name: 'halopsa_list_tenants',
    description:
      'List Azure tenant mappings for HaloPSA clients. Returns raw rows: Aatareaid (client ID), Aatazuretenantid (tenant GUID), Aatazuretenantname, Aatazuretenantdomain. Use Aatazuretenantdomain as tenantFilter for CIPP tools. Filter by client_id (from halopsa_get_user_azure_id) or search on Azure tenant name/domain.',
    keywords: ['halopsa', 'tenant', 'azure', 'cipp', 'list'],
    params: {
      client_id: z.number().optional().describe('HaloPSA client/area ID (from halopsa_get_user_azure_id)'),
      search: z.string().optional().describe('Filter by Azure tenant name or tenant domain (substring match)'),
    },
    readOnly: true,
    handler: async (params, ctx) => {
      const client = await getClient(ctx)
      let sql = `
        SELECT aat.Aatareaid, aat.Aatazuretenantid, aat.Aatazuretenantname, aat.Aatazuretenantdomain
        FROM Areaazuretenant aat
        JOIN Area a ON aat.Aatareaid = a.Aarea
      `
      if (params.client_id) {
        sql += ` WHERE aat.Aatareaid = ${Number(params.client_id)}`
      } else if (params.search) {
        const s = params.search.replace(/'/g, "''")
        sql += ` WHERE aat.Aatazuretenantdomain LIKE '%${s}%' OR aat.Aatazuretenantname LIKE '%${s}%'`
      }
      const result = (await client.executeQuery(sql)) as { report?: { rows?: unknown[] } }
      const rows = result?.report?.rows || []
      return trimResponse(rows)
    },
  }),

  defineTool({
    name: 'halopsa_get_user_azure_id',
    description:
      "Look up a HaloPSA user's Azure identity. Returns Azure OID (if set), email (usable as UPN for CIPP userId), and area/client ID (for tenant resolution). Inactive users excluded by default.",
    keywords: ['halopsa', 'user', 'azure', 'cipp', 'get'],
    params: {
      email: z.string().optional().describe('User email address (exact match)'),
      name: z.string().optional().describe('User display name (partial match)'),
      includeInactive: z.boolean().optional().describe('Include inactive users (default: false)'),
    },
    readOnly: true,
    handler: async (params, ctx) => {
      const client = await getClient(ctx)
      const conditions: string[] = []
      if (params.email) {
        const e = params.email.replace(/'/g, "''")
        conditions.push(`Uemail LIKE '${e}'`)
      }
      if (params.name) {
        const n = params.name.replace(/'/g, "''")
        conditions.push(`(uFirstName LIKE '%${n}%' OR uLastName LIKE '%${n}%')`)
      }
      if (conditions.length === 0) {
        return 'Either email or name is required.'
      }
      const inactiveFilter = params.includeInactive ? '' : ' AND uinactive = 0'
      const sql = `SELECT UAzureOID as azure_oid, uFirstName + ' ' + uLastName as user_name, Uemail as email, Uarea as client_id FROM Users WHERE (${conditions.join(' OR ')})${inactiveFilter}`
      const result = (await client.executeQuery(sql)) as { report?: { rows?: unknown[] } }
      const rows = result?.report?.rows || []
      return trimResponse(rows)
    },
  }),
]
