import type { Server } from 'node:http'
import express from 'express'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SignJWT, generateKeyPair } from 'jose'
import { ApiKeysStore } from '../src/storage/api-keys-store.js'
import { EntraValidator } from '../src/auth/entra.js'
import { createAuthMiddleware, getPrincipal } from '../src/auth/middleware.js'

let server: Server
let base: string
let rawKey: string
const keys = new ApiKeysStore('AuthMwT1')

beforeAll(async () => {
  const created = await keys.create('test key', ['read-only'])
  rawKey = created.rawKey
  const pair = await generateKeyPair('RS256')
  const validator = new EntraValidator({ tenantId: 'tid-1', clientId: 'client-1' }, async () => pair.publicKey)
  const goodToken = await new SignJWT({ oid: 'oid-9', groups: ['g1'] })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer('https://login.microsoftonline.com/tid-1/v2.0')
    .setAudience('client-1')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(pair.privateKey)
  // expose for tests
  const globalThis2 = globalThis as Record<string, unknown>
  globalThis2.__goodToken = goodToken

  const app = express()
  app.use(
    createAuthMiddleware({
      apiKeys: keys,
      getValidator: () => validator,
      resourceMetadataUrl: () => 'https://example.test/.well-known/oauth-protected-resource',
    }),
  )
  app.get('/whoami', (_req, res) => {
    res.json(getPrincipal(res))
  })
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve())
  })
  const addr = server.address() as { port: number }
  base = `http://127.0.0.1:${addr.port}`
})

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve))
})

describe('auth middleware', () => {
  it('valid api key yields apikey principal', async () => {
    const res = await fetch(`${base}/whoami`, { headers: { 'x-api-key': rawKey } })
    expect(res.status).toBe(200)
    const p = (await res.json()) as { kind: string; roleIds: string[] }
    expect(p.kind).toBe('apikey')
    expect(p.roleIds).toEqual(['read-only'])
  })

  it('invalid api key -> 401 with challenge', async () => {
    const res = await fetch(`${base}/whoami`, { headers: { 'x-api-key': 'cmk_' + '0'.repeat(32) } })
    expect(res.status).toBe(401)
    expect(res.headers.get('www-authenticate')).toContain('resource_metadata=')
  })

  it('valid bearer yields user principal', async () => {
    const token = (globalThis as Record<string, unknown>).__goodToken as string
    const res = await fetch(`${base}/whoami`, { headers: { authorization: `Bearer ${token}` } })
    expect(res.status).toBe(200)
    const p = (await res.json()) as { kind: string; oid: string; groups: string[] }
    expect(p).toMatchObject({ kind: 'user', oid: 'oid-9', groups: ['g1'] })
  })

  it('garbage bearer -> 401', async () => {
    const res = await fetch(`${base}/whoami`, { headers: { authorization: 'Bearer nope' } })
    expect(res.status).toBe(401)
  })

  it('no credentials -> 401 with challenge', async () => {
    const res = await fetch(`${base}/whoami`)
    expect(res.status).toBe(401)
    expect(res.headers.get('www-authenticate')).toContain('Bearer')
  })
})

describe('auth middleware backend failures', () => {
  let serverDown: Server
  let baseDown: string

  beforeAll(async () => {
    const app = express()
    const stubKeys = {
      verify: async () => {
        throw new Error('table down')
      },
    } as unknown as ApiKeysStore

    app.use(
      createAuthMiddleware({
        apiKeys: stubKeys,
        getValidator: () => undefined,
      }),
    )
    app.get('/whoami', (_req, res) => {
      res.json(getPrincipal(res))
    })
    await new Promise<void>((resolve) => {
      serverDown = app.listen(0, '127.0.0.1', () => resolve())
    })
    const addr = serverDown.address() as { port: number }
    baseDown = `http://127.0.0.1:${addr.port}`
  })

  afterAll(async () => {
    await new Promise((resolve) => serverDown.close(resolve))
  })

  it('apikey backend failure -> 503 with error message', async () => {
    const res = await fetch(`${baseDown}/whoami`, { headers: { 'x-api-key': 'cmk_' + '0'.repeat(32) } })
    expect(res.status).toBe(503)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('auth backend unavailable')
  })
})
