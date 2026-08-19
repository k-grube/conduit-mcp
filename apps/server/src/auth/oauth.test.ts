import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js'
import { createConduitProvider } from './oauth.js'
import type { EntraValidator } from './entra.js'

const tokenResponse = {
  ok: true,
  status: 200,
  json: async () => ({ access_token: 'at', token_type: 'Bearer', expires_in: 3600 }),
  text: async () => '',
  clone() {
    return this
  },
}

function makeProvider(fetchMock: typeof fetch) {
  vi.stubGlobal('fetch', fetchMock)
  return createConduitProvider(
    { tenantId: 'tenant-1', clientId: 'app-1', serverUrl: 'https://conduit.example' },
    {
      clients: { getClient: async () => undefined, registerClient: async (c: OAuthClientInformationFull) => c },
      validator: { validate: async () => ({ oid: 'oid', groups: [], name: 'n' }) } as unknown as EntraValidator,
    },
  )
}

const loopbackClient: OAuthClientInformationFull = {
  client_id: 'dcr-1',
  redirect_uris: ['http://localhost:47805/callback'],
}

describe('exchangeRefreshToken', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('defaults the scope when the client sends none', async () => {
    // entra 400s a scope-less refresh when the client is the resource app (AADSTS90009)
    const fetchMock = vi.fn().mockResolvedValue(tokenResponse)
    const provider = makeProvider(fetchMock as unknown as typeof fetch)

    await provider.exchangeRefreshToken(loopbackClient, 'rt-1', [])

    const body = new URLSearchParams(String(fetchMock.mock.calls[0][1]?.body))
    expect(body.get('scope')).toBe('api://app-1/mcp.access offline_access')
  })

  it('passes explicit scopes through unchanged', async () => {
    const fetchMock = vi.fn().mockResolvedValue(tokenResponse)
    const provider = makeProvider(fetchMock as unknown as typeof fetch)

    await provider.exchangeRefreshToken(loopbackClient, 'rt-1', ['api://app-1/mcp.access'])

    const body = new URLSearchParams(String(fetchMock.mock.calls[0][1]?.body))
    expect(body.get('scope')).toBe('api://app-1/mcp.access')
  })

  it('sends no client secret for a loopback client', async () => {
    const fetchMock = vi.fn().mockResolvedValue(tokenResponse)
    const provider = makeProvider(fetchMock as unknown as typeof fetch)

    await provider.exchangeRefreshToken(loopbackClient, 'rt-1', [])

    const body = new URLSearchParams(String(fetchMock.mock.calls[0][1]?.body))
    expect(body.get('client_secret')).toBeNull()
    expect(body.get('client_id')).toBe('app-1')
  })
})
