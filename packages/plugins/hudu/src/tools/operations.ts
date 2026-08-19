import { defineTool, z, type ToolDef } from '@conduit-mcp/plugin-sdk'
import { getClient } from '../client.js'
import { formatResult } from '../format.js'

export const operationTools: ToolDef[] = [
  defineTool({
    name: 'hudu_list_activity_logs',
    description:
      'List Hudu activity/audit log entries (user actions and record changes). Filter by user_id, user_email, resource_id plus resource_type, or action_message.',
    keywords: ['hudu', 'activity', 'audit', 'logs', 'history', 'changes', 'tracking'],
    params: {
      user_id: z.number().optional().describe('Filter by user ID'),
      user_email: z.string().optional().describe('Filter by user email'),
      resource_id: z.number().optional().describe('Filter by resource ID'),
      resource_type: z.string().optional().describe('Filter by resource type'),
      action_message: z.string().optional().describe('Filter by action message'),
      page: z.number().optional().default(1).describe('Page number (default 1)'),
      page_size: z.number().optional().default(25).describe('Results per page (default 25)'),
    },
    readOnly: true,
    handler: async (args, ctx) => {
      const client = getClient(ctx)
      const result = await client.getActivityLogs(args)
      // activity_logs returns a bare array, no envelope, formatResult array branch caps it
      return formatResult(result, client)
    },
  }),

  defineTool({
    name: 'hudu_list_folders',
    description: 'List Hudu folders (KB article organization). Filter by company_id and name.',
    keywords: ['hudu', 'folders', 'list', 'kb', 'articles'],
    params: {
      company_id: z.number().optional().describe('Filter by company ID'),
      name: z.string().optional().describe('Filter by folder name'),
      page: z.number().optional().default(1).describe('Page number (default 1)'),
      page_size: z.number().optional().default(25).describe('Results per page (default 25)'),
    },
    readOnly: true,
    handler: async (args, ctx) => {
      const client = getClient(ctx)
      const result = await client.getFolders(args)
      return formatResult(result, client, { collectionKey: 'folders' })
    },
  }),

  defineTool({
    name: 'hudu_get_folder',
    description: 'Get a specific Hudu folder by ID.',
    keywords: ['hudu', 'folder', 'get'],
    params: { id: z.number().describe('The folder ID') },
    readOnly: true,
    handler: async ({ id }, ctx) => {
      const client = getClient(ctx)
      const result = await client.getFolderById(id)
      return formatResult(result, client)
    },
  }),

  defineTool({
    name: 'hudu_list_procedures',
    description: 'List Hudu procedures (step-by-step process checklists). Filter by company_id and name.',
    keywords: ['hudu', 'procedures', 'checklists', 'list', 'sop', 'process', 'runbook'],
    params: {
      company_id: z.number().optional().describe('Filter by company ID'),
      name: z.string().optional().describe('Filter by procedure name'),
      page: z.number().optional().default(1).describe('Page number (default 1)'),
      page_size: z.number().optional().default(25).describe('Results per page (default 25)'),
    },
    readOnly: true,
    handler: async (args, ctx) => {
      const client = getClient(ctx)
      const result = await client.getProcedures(args)
      return formatResult(result, client, { collectionKey: 'procedures' })
    },
  }),

  defineTool({
    name: 'hudu_get_procedure',
    description: 'Get a specific Hudu procedure by ID.',
    keywords: ['hudu', 'procedure', 'checklist', 'get'],
    params: { id: z.number().describe('The procedure ID') },
    readOnly: true,
    handler: async ({ id }, ctx) => {
      const client = getClient(ctx)
      const result = await client.getProcedureById(id)
      return formatResult(result, client)
    },
  }),
]
