import { describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { definePlugin, defineTool, parseManifest, z, type PluginContext } from '@conduit-mcp/plugin-sdk'
import { ToolCatalog } from '../src/catalog/catalog.js'
import { ToolSearch } from '../src/catalog/search.js'
import { createMcpServer, type UsageEvent } from '../src/mcp/meta-tools.js'
import { resolvePermissions, type Permissions } from '../src/auth/permissions.js'
import { createPluginContext } from '../src/plugins/context.js'
import { ConfigStore } from '../src/storage/config-store.js'
import { EnvSecretProvider } from '../src/secrets/provider.js'
import { NotesService } from '../src/catalog/notes.js'

const stubCtx = {
  getSecret: async () => '',
  setSecret: async () => {},
  getConfig: async () => ({}),
  invokeTool: async () => undefined,
  logger: { info: () => {}, warn: () => {}, error: () => {} },
  store: { get: async () => undefined, set: async () => {}, delete: async () => {} },
} as PluginContext

function seededCatalog() {
  const cat = new ToolCatalog()
  cat.registerPlugin(
    parseManifest({ id: 'demo', name: 'Demo', toolPrefix: 'demo_', entry: 'e', sdkVersion: '^0.1' }),
    definePlugin({
      tools: [
        defineTool({
          name: 'demo_echo',
          description: 'echo text back',
          keywords: ['echo'],
          params: { text: z.string() },
          readOnly: true,
          handler: async (args) => args.text,
        }),
        defineTool({
          name: 'demo_fail',
          description: 'always fails',
          params: {},
          readOnly: false,
          handler: async () => {
            throw new Error('boom')
          },
        }),
        defineTool({
          name: 'demo_big',
          description: 'returns a big payload',
          params: {},
          readOnly: true,
          handler: async () => 'x'.repeat(100),
        }),
        defineTool({
          name: 'demo_noop',
          description: 'does nothing',
          params: {},
          readOnly: false,
          handler: async () => undefined,
        }),
      ],
    }),
    stubCtx,
  )
  return cat
}

const WILDCARD = resolvePermissions([
  { id: 'w', name: 'w', grants: [{ kind: 'wildcard_all' }], surfaces: ['mcp'], members: { users: [], groups: [] } },
])

async function connect(usage: UsageEvent[] = [], maxResultChars?: number, permissions: Permissions = WILDCARD) {
  const catalog = seededCatalog()
  const server = createMcpServer({
    catalog,
    search: new ToolSearch(catalog),
    onUsage: (e) => usage.push(e),
    maxResultChars,
    permissions,
  })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  const client = new Client({ name: 'test', version: '0.0.0' })
  await client.connect(clientTransport)
  return client
}

async function connectWithInstructions(instructions?: string) {
  const catalog = seededCatalog()
  const server = createMcpServer({ catalog, search: new ToolSearch(catalog), instructions })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  const client = new Client({ name: 'test', version: '0.0.0' })
  await client.connect(clientTransport)
  return client
}

async function connectRaw() {
  const catalog = seededCatalog()
  const server = createMcpServer({
    catalog,
    search: new ToolSearch(catalog),
  })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  const client = new Client({ name: 'test', version: '0.0.0' })
  await client.connect(clientTransport)
  return client
}

async function connectWithNotes(permissions: Permissions, tableName: string, usage: UsageEvent[] = []) {
  const catalog = seededCatalog()
  const config = new ConfigStore({ tableName })
  const notes = new NotesService({ config, catalog })
  await notes.start()
  const server = createMcpServer({
    catalog,
    search: new ToolSearch(catalog),
    onUsage: (e) => usage.push(e),
    permissions,
    notes,
  })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  const client = new Client({ name: 'test', version: '0.0.0' })
  await client.connect(clientTransport)
  return client
}

async function connectWithNotesAndCatalog(permissions: Permissions, tableName: string, usage: UsageEvent[] = []) {
  const catalog = seededCatalog()
  const config = new ConfigStore({ tableName })
  const notes = new NotesService({ config, catalog })
  await notes.start()
  const server = createMcpServer({
    catalog,
    search: new ToolSearch(catalog),
    onUsage: (e) => usage.push(e),
    permissions,
    notes,
  })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  const client = new Client({ name: 'test', version: '0.0.0' })
  await client.connect(clientTransport)
  return { client, catalog }
}

function text(result: unknown): string {
  return (result as { content: { type: string; text: string }[] }).content[0].text
}

describe('meta-tools', () => {
  it('exposes exactly the three meta-tools', async () => {
    const client = await connect()
    const tools = await client.listTools()
    expect(tools.tools.map((t) => t.name).sort()).toEqual(['find_tools', 'invoke_tool', 'list_integrations'])
  })

  it('list_integrations returns integration info', async () => {
    const client = await connect()
    const res = await client.callTool({ name: 'list_integrations', arguments: {} })
    expect(JSON.parse(text(res))).toEqual([{ id: 'demo', name: 'Demo', toolCount: 4 }])
  })

  it('find_tools returns matching schemas', async () => {
    const client = await connect()
    const res = await client.callTool({ name: 'find_tools', arguments: { query: 'echo text' } })
    const hits = JSON.parse(text(res)) as { name: string; inputSchema: unknown }[]
    expect(hits[0].name).toBe('demo_echo')
    expect(hits[0].inputSchema).toMatchObject({ type: 'object' })
  })

  it('invoke_tool runs a tool and records usage', async () => {
    const usage: UsageEvent[] = []
    const client = await connect(usage)
    const res = await client.callTool({ name: 'invoke_tool', arguments: { name: 'demo_echo', args: { text: 'hi' } } })
    expect(text(res)).toBe('hi')
    expect(usage).toHaveLength(1)
    expect(usage[0]).toMatchObject({ tool: 'demo_echo', pluginId: 'demo', ok: true, principal: 'anonymous' })
  })

  it('invoke_tool surfaces validation issues as isError', async () => {
    const usage: UsageEvent[] = []
    const client = await connect(usage)
    const res = await client.callTool({ name: 'invoke_tool', arguments: { name: 'demo_echo', args: { text: 5 } } })
    expect((res as { isError?: boolean }).isError).toBe(true)
    expect(text(res)).toMatch(/text/)
    expect(usage[0].ok).toBe(false)
  })

  it('invoke_tool surfaces handler errors as isError with usage', async () => {
    const usage: UsageEvent[] = []
    const client = await connect(usage)
    const res = await client.callTool({ name: 'invoke_tool', arguments: { name: 'demo_fail' } })
    expect((res as { isError?: boolean }).isError).toBe(true)
    expect(text(res)).toMatch(/boom/)
    expect(usage[0]).toMatchObject({ ok: false, error: 'boom' })
  })

  it('unknown tool suggests near matches', async () => {
    const client = await connect()
    const res = await client.callTool({ name: 'invoke_tool', arguments: { name: 'demo_ech' } })
    expect((res as { isError?: boolean }).isError).toBe(true)
    expect(text(res)).toMatch(/demo_echo/)
  })

  it('truncates oversized results', async () => {
    const client = await connect([], 50)
    const res = await client.callTool({ name: 'invoke_tool', arguments: { name: 'demo_big' } })
    expect(text(res)).toMatch(/\[truncated 50 chars\]$/)
  })

  it('handles tools that return undefined', async () => {
    const usage: UsageEvent[] = []
    const client = await connect(usage)
    const res = await client.callTool({ name: 'invoke_tool', arguments: { name: 'demo_noop' } })
    expect((res as { isError?: boolean }).isError).toBeUndefined()
    expect(text(res)).toBe('null')
    expect(usage[0]).toMatchObject({ ok: true })
  })
})

describe('permission filtering', () => {
  const readOnly = resolvePermissions([
    {
      id: 'ro',
      name: 'ro',
      grants: [{ kind: 'integration', integrationId: '*', mode: 'read' }],
      surfaces: ['mcp'],
      members: { users: [], groups: [] },
    },
  ])

  it('find_tools hides denied tools', async () => {
    const client = await connect([], undefined, readOnly)
    const res = await client.callTool({ name: 'find_tools', arguments: { query: 'fails' } })
    const names = (JSON.parse(text(res)) as { name: string }[]).map((h) => h.name)
    expect(names).not.toContain('demo_fail')
  })

  it('invoke_tool treats denied as unknown', async () => {
    const usage: UsageEvent[] = []
    const client = await connect(usage, undefined, readOnly)
    const res = await client.callTool({ name: 'invoke_tool', arguments: { name: 'demo_fail' } })
    expect((res as { isError?: boolean }).isError).toBe(true)
    expect(text(res)).toMatch(/unknown tool/)
    expect(usage).toEqual([])
  })

  it('allowed tools still work under scoped permissions', async () => {
    const client = await connect([], undefined, readOnly)
    const res = await client.callTool({ name: 'invoke_tool', arguments: { name: 'demo_echo', args: { text: 'ok' } } })
    expect(text(res)).toBe('ok')
  })

  it('list_integrations reports a permission-filtered tool count, not the raw total', async () => {
    const client = await connect([], undefined, readOnly)
    const res = await client.callTool({ name: 'list_integrations', arguments: {} })
    expect(JSON.parse(text(res))).toEqual([{ id: 'demo', name: 'Demo', toolCount: 2 }])
  })

  it('list_integrations hides ungranted integrations', async () => {
    const none = resolvePermissions([])
    const client = await connect([], undefined, none)
    const res = await client.callTool({ name: 'list_integrations', arguments: {} })
    expect(JSON.parse(text(res))).toEqual([])
  })

  it('no permissions passed denies by default', async () => {
    const client = await connectRaw()
    const res = await client.callTool({ name: 'invoke_tool', arguments: { name: 'demo_echo', args: { text: 'x' } } })
    expect((res as { isError?: boolean }).isError).toBe(true)
  })
})

// C2/I5: ctx.invokeTool must enforce the ORIGINATING mcp principal's grants, not just the
// invoked plugin's own identity, and attribute the inner usage row to that human, not the plugin
describe('cross-plugin invoke authorization (C2/I5)', () => {
  const haloManifest = parseManifest({
    id: 'halopsa',
    name: 'HaloPSA',
    toolPrefix: 'halopsa_',
    entry: 'e',
    sdkVersion: '^0.1',
  })
  const qboManifest = parseManifest({
    id: 'quickbooks',
    name: 'QuickBooks',
    toolPrefix: 'qbo_',
    entry: 'e',
    sdkVersion: '^0.1',
  })

  function seedCrossPluginCatalog(usage: UsageEvent[], tableSuffix: string) {
    const catalog = new ToolCatalog()
    const push = (e: UsageEvent) => usage.push(e)
    const haloCtx = createPluginContext(haloManifest, {
      secrets: new EnvSecretProvider(),
      config: new ConfigStore({ tableName: `MetaAuthHaloCfg${tableSuffix}` }),
      storeTableName: `MetaAuthHaloStore${tableSuffix}`,
      getCatalog: () => catalog,
      onUsage: push,
    })
    const qboCtx = createPluginContext(qboManifest, {
      secrets: new EnvSecretProvider(),
      config: new ConfigStore({ tableName: `MetaAuthQboCfg${tableSuffix}` }),
      storeTableName: `MetaAuthQboStore${tableSuffix}`,
      getCatalog: () => catalog,
      onUsage: push,
    })
    catalog.registerPlugin(
      haloManifest,
      definePlugin({
        tools: [
          defineTool({
            name: 'halopsa_get_client',
            description: 'get a halo client',
            params: { id: z.number() },
            readOnly: true,
            handler: async (args) => ({ id: args.id, name: 'Acme', accountsid: 501 }),
          }),
        ],
      }),
      haloCtx,
    )
    catalog.registerPlugin(
      qboManifest,
      definePlugin({
        tools: [
          // mirrors quickbooks/src/tools/halo-link.ts: on ctx.invokeTool rejection (unknown tool,
          // halo api error, or now not-authorized) degrade to a halo_link_missing-shaped envelope
          defineTool({
            name: 'qbo_get_customer_for_halo_client',
            description: 'get the qbo customer linked to a halo client',
            params: { halo_client_id: z.number() },
            readOnly: true,
            handler: async (args, ctx) => {
              try {
                const halo = await ctx.invokeTool<{ id: number; name: string; accountsid: number }>(
                  'halopsa_get_client',
                  { id: args.halo_client_id },
                )
                return { halo }
              } catch (err) {
                return { error: 'halo_link_missing', message: err instanceof Error ? err.message : String(err) }
              }
            },
          }),
        ],
      }),
      qboCtx,
    )
    return { catalog, qboCtx }
  }

  async function connectCrossPlugin(catalog: ToolCatalog, usage: UsageEvent[], principal: string, perms: Permissions) {
    const server = createMcpServer({
      catalog,
      search: new ToolSearch(catalog),
      onUsage: (e) => usage.push(e),
      principal,
      permissions: perms,
    })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await server.connect(serverTransport)
    const client = new Client({ name: 'test', version: '0.0.0' })
    await client.connect(clientTransport)
    return client
  }

  it('a read grant on qbo only cannot reach halopsa through a nested invoke, the qbo tool degrades', async () => {
    const usage: UsageEvent[] = []
    const { catalog } = seedCrossPluginCatalog(usage, 'Denied')
    const qboOnly = resolvePermissions([
      {
        id: 'qbo-ro',
        name: 'qbo-ro',
        grants: [{ kind: 'integration', integrationId: 'quickbooks', mode: 'read' }],
        surfaces: ['mcp'],
        members: { users: [], groups: [] },
      },
    ])
    const client = await connectCrossPlugin(catalog, usage, 'human-1', qboOnly)

    const res = await client.callTool({
      name: 'invoke_tool',
      arguments: { name: 'qbo_get_customer_for_halo_client', args: { halo_client_id: 42 } },
    })

    const parsed = JSON.parse(text(res)) as { error: string; message: string }
    expect(parsed.error).toBe('halo_link_missing')
    expect(parsed.message).toMatch(/not authorized for tool halopsa_get_client/)
  })

  it('grants on both integrations succeed, and the inner usage row carries the human principal', async () => {
    const usage: UsageEvent[] = []
    const { catalog } = seedCrossPluginCatalog(usage, 'Allowed')
    const both = resolvePermissions([
      {
        id: 'both-ro',
        name: 'both-ro',
        grants: [
          { kind: 'integration', integrationId: 'quickbooks', mode: 'read' },
          { kind: 'integration', integrationId: 'halopsa', mode: 'read' },
        ],
        surfaces: ['mcp'],
        members: { users: [], groups: [] },
      },
    ])
    const client = await connectCrossPlugin(catalog, usage, 'human-1', both)

    const res = await client.callTool({
      name: 'invoke_tool',
      arguments: { name: 'qbo_get_customer_for_halo_client', args: { halo_client_id: 42 } },
    })

    const parsed = JSON.parse(text(res)) as { halo: { id: number; name: string; accountsid: number } }
    expect(parsed.halo).toEqual({ id: 42, name: 'Acme', accountsid: 501 })

    const inner = usage.find((u) => u.tool === 'halopsa_get_client')
    expect(inner).toMatchObject({ principal: 'human-1', pluginId: 'halopsa', ok: true })
  })

  it('a job/boot-context invoke with no ALS stashed is unrestricted, same as before this existed', async () => {
    const usage: UsageEvent[] = []
    const { qboCtx } = seedCrossPluginCatalog(usage, 'Job')
    const result = await qboCtx.invokeTool('halopsa_get_client', { id: 7 })
    expect(result).toEqual({ id: 7, name: 'Acme', accountsid: 501 })
    expect(usage[0]).toMatchObject({ tool: 'halopsa_get_client', principal: 'plugin:quickbooks', ok: true })
  })
})

describe('tool notes', () => {
  it('update_tool_notes is hidden without the grant', async () => {
    const readOnly = resolvePermissions([
      {
        id: 'r',
        name: 'r',
        grants: [{ kind: 'integration', integrationId: '*', mode: 'all' }],
        surfaces: ['mcp'],
        members: { users: [], groups: [] },
      },
    ])
    const gated = await connectWithNotes(readOnly, 'MetaNotesA')
    const tools = await gated.listTools()
    expect(tools.tools.map((t) => t.name)).not.toContain('update_tool_notes')
  })

  it('update + read back through find_tools and list_integrations', async () => {
    const { client } = await connectWithNotesAndCatalog(WILDCARD, 'MetaNotesB')
    await client.callTool({
      name: 'update_tool_notes',
      arguments: { integration: 'demo', tool: 'demo_echo', notes: 'CFClientCode is the client short code' },
    })
    await client.callTool({
      name: 'update_tool_notes',
      arguments: { integration: 'demo', notes: 'demo-wide lore' },
    })
    const found = await client.callTool({ name: 'find_tools', arguments: { query: 'CFClientCode short code' } })
    const hits = JSON.parse(text(found)) as { name: string; notes?: string; integration_notes?: string }[]
    const echo = hits.find((h) => h.name === 'demo_echo')
    expect(echo?.notes).toBe('CFClientCode is the client short code')
    expect(echo?.integration_notes).toBe('demo-wide lore')
    const ints = await client.callTool({ name: 'list_integrations', arguments: {} })
    expect(JSON.parse(text(ints))[0].notes).toBe('demo-wide lore')
  })

  it('errors are isError results', async () => {
    const { client } = await connectWithNotesAndCatalog(WILDCARD, 'MetaNotesC')
    const res = await client.callTool({
      name: 'update_tool_notes',
      arguments: { integration: 'nope', notes: 'x' },
    })
    expect((res as { isError?: boolean }).isError).toBe(true)
    expect(text(res)).toContain('unknown integration')
  })
})

describe('server instructions', () => {
  it('surfaces the instructions string to the client at initialize', async () => {
    const client = await connectWithInstructions('update available, restart from settings')
    expect(client.getInstructions()).toBe('update available, restart from settings')
  })

  it('sends no instructions when none are given', async () => {
    const client = await connectWithInstructions(undefined)
    expect(client.getInstructions()).toBeUndefined()
  })
})
