import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { ToolCatalog } from '../catalog/catalog.js'
import type { ToolSearch } from '../catalog/search.js'
import { allowsTool, filterIntegrations, NO_PERMISSIONS, type Permissions } from '../auth/permissions.js'
import { invokeCallerContext } from '../plugins/context.js'
import { NoteTooLongError, UnknownNotesTargetError, type NotesService } from '../catalog/notes.js'

export interface UsageEvent {
  tool: string
  pluginId: string
  principal: string
  ok: boolean
  durationMs: number
  chars: number
  error?: string
}

export interface MetaToolDeps {
  catalog: ToolCatalog
  search: ToolSearch
  principal?: string
  onUsage?: (e: UsageEvent) => void
  maxResultChars?: number
  permissions?: Permissions
  notes?: NotesService
  instructions?: string
}

function textResult(text: string, isError = false) {
  return { content: [{ type: 'text' as const, text }], ...(isError ? { isError: true } : {}) }
}

export function createMcpServer(deps: MetaToolDeps): McpServer {
  const principal = deps.principal ?? 'anonymous'
  const maxChars = deps.maxResultChars ?? 50_000
  const perms = deps.permissions ?? NO_PERMISSIONS
  const server = new McpServer({ name: 'conduit-mcp', version: '0.1.0' }, { instructions: deps.instructions })

  server.registerTool(
    'list_integrations',
    {
      description: 'List enabled integrations and their tool counts. Start here to orient yourself.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      const infos = filterIntegrations(perms, deps.catalog.integrations()).map((info) => {
        const notes = deps.catalog.integrationNotes(info.id)
        return {
          ...info,
          toolCount: deps.catalog.list(info.id).filter((e) => allowsTool(perms, e)).length,
          ...(notes ? { notes } : {}),
        }
      })
      return textResult(JSON.stringify(infos))
    },
  )

  server.registerTool(
    'find_tools',
    {
      description:
        'Search the tool catalog by task description or keywords. Returns matching tool schemas for use with invoke_tool.',
      inputSchema: {
        query: z.string().describe('what you want to do, e.g. "list open tickets"'),
        integration: z.string().optional().describe('restrict to one integration id'),
        limit: z.number().int().min(1).max(25).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ query, integration, limit }) => {
      const hits = deps.search
        .search(query, { integration, limit: 50 })
        .filter((h) => allowsTool(perms, h))
        .slice(0, limit ?? 10)
      return textResult(
        JSON.stringify(
          hits.map((h) => ({
            name: h.name,
            integration: h.pluginId,
            description: h.description,
            readOnly: h.readOnly,
            inputSchema: h.jsonSchema,
            ...(h.notes ? { notes: h.notes } : {}),
            ...(deps.catalog.integrationNotes(h.pluginId)
              ? { integration_notes: deps.catalog.integrationNotes(h.pluginId) }
              : {}),
          })),
        ),
      )
    },
  )

  server.registerTool(
    'invoke_tool',
    {
      description: 'Invoke a tool found via find_tools, with arguments matching its inputSchema.',
      inputSchema: {
        name: z.string().describe('exact tool name from find_tools'),
        args: z.record(z.string(), z.unknown()).optional(),
      },
    },
    async ({ name, args }) => {
      const entry = deps.catalog.get(name)
      if (!entry || !allowsTool(perms, entry)) {
        const near = deps.search
          .search(name, { limit: 50 })
          .filter((e) => allowsTool(perms, e))
          .slice(0, 3)
          .map((e) => e.name)
        const hint = near.length ? ` did_you_mean: ${near.join(', ')}` : ''
        return textResult(`unknown tool: ${name}.${hint}`, true)
      }
      const started = Date.now()
      const usage = (ok: boolean, chars: number, error?: string) => {
        deps.onUsage?.({
          tool: entry.name,
          pluginId: entry.pluginId,
          principal,
          ok,
          durationMs: Date.now() - started,
          chars,
          error,
        })
      }
      const validated = entry.validate(args)
      if (!validated.ok) {
        usage(false, 0, 'validation failed')
        return textResult(JSON.stringify({ issues: validated.issues }), true)
      }
      try {
        // stashes this principal's resolved permissions for the whole invoke chain, so a nested
        // ctx.invokeTool inside the handler enforces the ORIGINATING principal's grants, not the
        // invoked plugin's own identity (see context.ts's invokeCallerContext)
        const result = await invokeCallerContext.run({ depth: 0, principalId: principal, permissions: perms }, () =>
          entry.invoke(validated.data),
        )
        let text: string
        if (typeof result === 'string') {
          text = result
        } else {
          text = JSON.stringify(result) ?? 'null'
        }
        if (text.length > maxChars) {
          const over = text.length - maxChars
          text = `${text.slice(0, maxChars)}\n[truncated ${over} chars]`
        }
        usage(true, text.length)
        return textResult(text)
      } catch (err) {
        const message = (err as Error).message
        usage(false, 0, message)
        return textResult(`tool error: ${message}`, true)
      }
    },
  )

  const notesService = deps.notes
  if (notesService && perms.notesWrite) {
    server.registerTool(
      'update_tool_notes',
      {
        description:
          'Save operator notes onto a tool (or a whole integration when tool is omitted). ' +
          'Notes surface as a separate notes field in find_tools results and are searchable. ' +
          'null or empty text clears.',
        inputSchema: {
          integration: z.string().describe('integration id from list_integrations'),
          tool: z.string().optional().describe('exact tool name, omit for an integration-level note'),
          notes: z.string().nullable().describe('note text, null to clear'),
        },
      },
      async ({ integration, tool, notes }) => {
        try {
          await notesService.update({ integration, tool, notes, principal })
          return textResult(JSON.stringify({ ok: true }))
        } catch (err) {
          if (err instanceof UnknownNotesTargetError || err instanceof NoteTooLongError) {
            return textResult(err.message, true)
          }
          throw err
        }
      },
    )
  }

  return server
}
