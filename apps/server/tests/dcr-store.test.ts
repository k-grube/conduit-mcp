import { describe, expect, it } from 'vitest'
import { ensureTable } from '../src/storage/tables.js'
import { AdtClientsStore } from '../src/auth/dcr-store.js'

const client = {
  client_id: 'c-1',
  client_name: 'claude',
  redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
  token_endpoint_auth_method: 'none',
  grant_types: ['authorization_code', 'refresh_token'],
  response_types: ['code'],
}

describe('AdtClientsStore', () => {
  it('registers and fetches a client', async () => {
    const store = new AdtClientsStore('DcrT1')
    await store.registerClient(client)
    expect(await store.getClient('c-1')).toMatchObject({ client_id: 'c-1', client_name: 'claude' })
  })

  it('getClient returns undefined for unknown', async () => {
    const store = new AdtClientsStore('DcrT2')
    expect(await store.getClient('nope')).toBeUndefined()
  })

  it('refreshes timestamp on getClient to avoid retention sweep', async () => {
    const store = new AdtClientsStore('DcrT3')
    await store.registerClient(client)
    const table = await ensureTable('DcrT3')
    const e1 = (await table.getEntity('dcr', 'c-1')) as unknown as Record<string, unknown>
    const ts1Str = (e1['timestamp'] as string) || ''
    await new Promise((r) => setTimeout(r, 1200))
    await store.getClient('c-1')
    await new Promise((r) => setTimeout(r, 200))
    const e2 = (await table.getEntity('dcr', 'c-1')) as unknown as Record<string, unknown>
    const ts2Str = (e2['timestamp'] as string) || ''
    expect(ts2Str).toBeTruthy()
    expect(ts2Str > ts1Str).toBe(true)
  })
})

describe('GuardedClientsStore', () => {
  it('allows allowlisted hosts and subdomains', async () => {
    const { GuardedClientsStore } = await import('../src/auth/dcr-store.js')
    const store = new GuardedClientsStore(new AdtClientsStore('DcrT3'), () => ['claude.ai', 'localhost'])
    await expect(
      store.registerClient({ ...client, client_id: 'g1', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] }),
    ).resolves.toBeDefined()
    await expect(
      store.registerClient({ ...client, client_id: 'g2', redirect_uris: ['http://localhost:3000/cb'] }),
    ).resolves.toBeDefined()
  })

  it('rejects unlisted hosts', async () => {
    const { GuardedClientsStore } = await import('../src/auth/dcr-store.js')
    const store = new GuardedClientsStore(new AdtClientsStore('DcrT4'), () => ['claude.ai'])
    await expect(
      store.registerClient({ ...client, client_id: 'g3', redirect_uris: ['https://evil.example/cb'] }),
    ).rejects.toThrow(/redirect/)
    expect(await store.getClient('g3')).toBeUndefined()
  })

  it('rejects lookalike hosts', async () => {
    const { GuardedClientsStore } = await import('../src/auth/dcr-store.js')
    const store = new GuardedClientsStore(new AdtClientsStore('DcrT5'), () => ['claude.ai'])
    await expect(
      store.registerClient({ ...client, client_id: 'g4', redirect_uris: ['https://notclaude.ai.evil.example/cb'] }),
    ).rejects.toThrow(/redirect/)
  })

  it('rejects a custom scheme claiming an allowed host', async () => {
    const { GuardedClientsStore } = await import('../src/auth/dcr-store.js')
    const store = new GuardedClientsStore(new AdtClientsStore('DcrT6'), () => ['claude.ai'])
    await expect(
      store.registerClient({ ...client, client_id: 'g5', redirect_uris: ['myapp://claude.ai/cb'] }),
    ).rejects.toThrow(/redirect/)
  })

  it('getClient re-checks a stored client against the current allowlist and rejects a stale entry', async () => {
    const { GuardedClientsStore } = await import('../src/auth/dcr-store.js')
    const inner = new AdtClientsStore('DcrT7')
    // written directly to the inner store, bypassing the guard, simulating a row that predates the allowlist
    await inner.registerClient({ ...client, client_id: 'g6', redirect_uris: ['https://evil.example/cb'] })
    const store = new GuardedClientsStore(inner, () => ['claude.ai'])
    expect(await store.getClient('g6')).toBeUndefined()
  })
})
