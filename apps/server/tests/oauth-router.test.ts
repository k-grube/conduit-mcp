import type { Server } from 'node:http'
import express from 'express'
import { generateKeyPair } from 'jose'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { AdtClientsStore } from '../src/auth/dcr-store.js'
import { EntraValidator } from '../src/auth/entra.js'
import { createConduitProvider, createOAuthRouter } from '../src/auth/oauth.js'

const cfg = { tenantId: 'tid-1', clientId: 'client-1', serverUrl: 'https://conduit.example.test' }

const dcrPayload = {
  client_name: 'claude',
  redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
  token_endpoint_auth_method: 'none',
  grant_types: ['authorization_code', 'refresh_token'],
  response_types: ['code'],
}

let server: Server
let base: string

beforeAll(async () => {
  const pair = await generateKeyPair('RS256')
  const validator = new EntraValidator({ tenantId: cfg.tenantId, clientId: cfg.clientId }, async () => pair.publicKey)
  const app = express()
  app.use(express.json())
  app.use(createOAuthRouter(cfg, { clients: new AdtClientsStore('OAuthT1'), validator }))
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve())
  })
  const addr = server.address() as { port: number }
  base = `http://127.0.0.1:${addr.port}`
})

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve))
})

describe('oauth proxy router', () => {
  it('serves authorization server metadata on our own issuer', async () => {
    const res = await fetch(`${base}/.well-known/oauth-authorization-server`)
    expect(res.status).toBe(200)
    const meta = (await res.json()) as Record<string, string> & { scopes_supported: string[] }
    expect(meta.authorization_endpoint).toContain('conduit.example.test')
    expect(meta.token_endpoint).toContain('conduit.example.test')
    expect(meta.registration_endpoint).toBeDefined()
    // aud-pinned validator rejects graph-audience tokens, so the mcp resource scope must be requested
    expect(meta.scopes_supported).toEqual([
      'openid',
      'profile',
      'email',
      'offline_access',
      `api://${cfg.clientId}/mcp.access`,
    ])
  })

  it('issues never-expiring secrets to confidential dcr clients', async () => {
    const res = await fetch(`${base}/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...dcrPayload, token_endpoint_auth_method: 'client_secret_post' }),
    })
    expect(res.status).toBe(201)
    const info = (await res.json()) as { client_secret?: string; client_secret_expires_at?: number }
    expect(info.client_secret).toBeTruthy()
    expect(info.client_secret_expires_at).toBe(0)
  })

  it('registers a client via dcr and persists it', async () => {
    const res = await fetch(`${base}/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(dcrPayload),
    })
    expect(res.status).toBe(201)
    const info = (await res.json()) as { client_id: string }
    expect(info.client_id).toBeTruthy()
    const store = new AdtClientsStore('OAuthT1')
    expect(await store.getClient(info.client_id)).toBeDefined()
  })

  it('authorize swaps the dcr client_id for the entra app client_id', async () => {
    const reg = await fetch(`${base}/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(dcrPayload),
    })
    const { client_id: dcrClientId } = (await reg.json()) as { client_id: string }

    const params = new URLSearchParams({
      client_id: dcrClientId,
      redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
      response_type: 'code',
      code_challenge: 'abc',
      code_challenge_method: 'S256',
      state: 's1',
    })
    const res = await fetch(`${base}/authorize?${params}`, { redirect: 'manual' })
    expect(res.status).toBeGreaterThanOrEqual(300)
    expect(res.status).toBeLessThan(400)
    const location = res.headers.get('location') ?? ''
    expect(location).toContain('login.microsoftonline.com')
    expect(location).toContain(`client_id=${cfg.clientId}`)
    expect(location).not.toContain(`client_id=${dcrClientId}`)
    expect(location).toContain('state=s1')
    expect(location).toContain('code_challenge=abc')
  })

  it('authorize drops the mcp resource param before redirecting to entra', async () => {
    const reg = await fetch(`${base}/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(dcrPayload),
    })
    const { client_id: dcrClientId } = (await reg.json()) as { client_id: string }

    const params = new URLSearchParams({
      client_id: dcrClientId,
      redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
      response_type: 'code',
      code_challenge: 'abc',
      code_challenge_method: 'S256',
      state: 's2',
      resource: 'https://conduit.example.test/',
    })
    const res = await fetch(`${base}/authorize?${params}`, { redirect: 'manual' })
    const location = res.headers.get('location') ?? ''
    expect(location).toContain('login.microsoftonline.com')
    expect(location).not.toContain('resource=')
  })
})

describe('token exchange client-id swap', () => {
  let stub: Server
  let stubBase: string
  let capturedBody: URLSearchParams | undefined

  beforeAll(async () => {
    const app = express()
    app.use(express.urlencoded({ extended: false }))
    app.post('/token', (req, res) => {
      capturedBody = new URLSearchParams(req.body as Record<string, string>)
      res.json({ access_token: 'x', token_type: 'bearer' })
    })
    app.post('/token400', (_req, res) => {
      res.status(400).json({ error: 'invalid_target', error_description: 'AADSTS9010010: resource mismatch' })
    })
    await new Promise<void>((resolve) => {
      stub = app.listen(0, '127.0.0.1', () => resolve())
    })
    const addr = stub.address() as { port: number }
    stubBase = `http://127.0.0.1:${addr.port}`
  })

  afterAll(async () => {
    await new Promise((resolve) => stub.close(resolve))
  })

  it('exchangeAuthorizationCode sends the entra app client_id upstream, not the dcr client_id', async () => {
    const validator = new EntraValidator({ tenantId: cfg.tenantId, clientId: cfg.clientId })
    const provider = createConduitProvider(
      cfg,
      { clients: new AdtClientsStore('OAuthT2'), validator },
      { tokenUrl: `${stubBase}/token` },
    )
    const dcrClient = { client_id: 'dcr-abc', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] }
    await provider.exchangeAuthorizationCode(dcrClient, 'code', 'verifier', 'https://claude.ai/api/mcp/auth_callback')
    expect(capturedBody?.get('client_id')).toBe(cfg.clientId)
  })

  it('never forwards a dcr-minted client_secret to entra', async () => {
    const validator = new EntraValidator({ tenantId: cfg.tenantId, clientId: cfg.clientId })
    const provider = createConduitProvider(
      cfg,
      { clients: new AdtClientsStore('OAuthT3'), validator },
      { tokenUrl: `${stubBase}/token` },
    )
    const dcrClient = {
      client_id: 'dcr-abc',
      client_secret: 'locally-minted-secret',
      redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
    }
    await provider.exchangeAuthorizationCode(dcrClient, 'code', 'verifier', 'https://claude.ai/api/mcp/auth_callback')
    expect(capturedBody?.get('client_id')).toBe(cfg.clientId)
    expect(capturedBody?.has('client_secret')).toBe(false)
  })

  it('never forwards the mcp resource param to entra', async () => {
    const validator = new EntraValidator({ tenantId: cfg.tenantId, clientId: cfg.clientId })
    const provider = createConduitProvider(
      cfg,
      { clients: new AdtClientsStore('OAuthT4'), validator },
      { tokenUrl: `${stubBase}/token` },
    )
    const dcrClient = { client_id: 'dcr-abc', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] }
    await provider.exchangeAuthorizationCode(
      dcrClient,
      'code',
      'verifier',
      'https://claude.ai/api/mcp/auth_callback',
      new URL('https://conduit.example.test/'),
    )
    expect(capturedBody?.has('resource')).toBe(false)

    await provider.exchangeRefreshToken(dcrClient, 'refresh-1', undefined, new URL('https://conduit.example.test/'))
    expect(capturedBody?.has('resource')).toBe(false)
  })

  it('redeems non-loopback callbacks as the confidential client', async () => {
    const validator = new EntraValidator({ tenantId: cfg.tenantId, clientId: cfg.clientId })
    const provider = createConduitProvider(
      cfg,
      {
        clients: new AdtClientsStore('OAuthT6'),
        validator,
        getClientSecret: async () => 'entra-secret',
      },
      { tokenUrl: `${stubBase}/token` },
    )
    const dcrClient = { client_id: 'dcr-abc', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] }
    await provider.exchangeAuthorizationCode(dcrClient, 'code', 'verifier', 'https://claude.ai/api/mcp/auth_callback')
    expect(capturedBody?.get('client_id')).toBe(cfg.clientId)
    expect(capturedBody?.get('client_secret')).toBe('entra-secret')

    await provider.exchangeAuthorizationCode(dcrClient, 'code', 'verifier', 'http://localhost:33418/callback')
    expect(capturedBody?.has('client_secret')).toBe(false)

    await provider.exchangeAuthorizationCode(
      dcrClient,
      'code',
      'verifier',
      'http://127.0.0.1:3000/api/mcp/auth_callback',
    )
    expect(capturedBody?.has('client_secret')).toBe(false)
  })

  it('refresh infers loopback from the dcr client redirect uris', async () => {
    const validator = new EntraValidator({ tenantId: cfg.tenantId, clientId: cfg.clientId })
    const provider = createConduitProvider(
      cfg,
      {
        clients: new AdtClientsStore('OAuthT7'),
        validator,
        getClientSecret: async () => 'entra-secret',
      },
      { tokenUrl: `${stubBase}/token` },
    )
    await provider.exchangeRefreshToken(
      { client_id: 'dcr-web', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] },
      'refresh-1',
    )
    expect(capturedBody?.get('client_secret')).toBe('entra-secret')

    await provider.exchangeRefreshToken(
      { client_id: 'dcr-loopback', redirect_uris: ['http://localhost:33418/callback'] },
      'refresh-2',
    )
    expect(capturedBody?.has('client_secret')).toBe(false)
  })

  it('logs the upstream error body when the exchange fails', async () => {
    const writes: string[] = []
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk): boolean => {
      writes.push(String(chunk))
      return true
    })
    try {
      const validator = new EntraValidator({ tenantId: cfg.tenantId, clientId: cfg.clientId })
      const provider = createConduitProvider(
        cfg,
        { clients: new AdtClientsStore('OAuthT5'), validator },
        { tokenUrl: `${stubBase}/token400` },
      )
      const dcrClient = { client_id: 'dcr-abc', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] }
      await expect(
        provider.exchangeAuthorizationCode(dcrClient, 'code', 'verifier', 'https://claude.ai/api/mcp/auth_callback'),
      ).rejects.toThrow()
      expect(writes.join('')).toContain('AADSTS9010010')
    } finally {
      spy.mockRestore()
    }
  })
})
