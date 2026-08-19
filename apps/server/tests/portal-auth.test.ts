import type { Server } from 'node:http'
import express from 'express'
import { SignJWT, generateKeyPair } from 'jose'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { EntraValidator } from '../src/auth/entra.js'
import { createPortalAuthMiddleware, requirePortalAdmin } from '../src/auth/portal.js'
import { RolesStore } from '../src/storage/roles-store.js'

let server: Server
let base: string
let adminToken: string
let strangerToken: string
let pair: Awaited<ReturnType<typeof generateKeyPair>>
let validator: EntraValidator

const roles = new RolesStore('PortalT1')

beforeAll(async () => {
  await roles.seedBuiltins()
  const admin = (await roles.get('portal-admin'))!
  await roles.upsert({ ...admin, members: { users: ['oid-admin'], groups: [] } })
  pair = await generateKeyPair('RS256')
  validator = new EntraValidator({ tenantId: 'tid-1', clientId: 'client-1' }, async () => pair.publicKey)
  const sign = (oid: string, extra: Record<string, unknown> = {}) =>
    new SignJWT({ oid, ...extra })
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer('https://login.microsoftonline.com/tid-1/v2.0')
      .setAudience('client-1')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(pair.privateKey)
  adminToken = await sign('oid-admin', { scp: 'portal.access' })
  strangerToken = await sign('oid-stranger', { scp: 'portal.access' })

  const app = express()
  app.use(createPortalAuthMiddleware({ getValidator: () => validator, roles }))
  app.get('/probe', (_req, res) => {
    res.json({ ok: true })
  })
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve())
  })
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve))
})

describe('portal auth', () => {
  it('rejects missing bearer', async () => {
    expect((await fetch(`${base}/probe`)).status).toBe(401)
  })

  it('rejects api keys outright', async () => {
    const res = await fetch(`${base}/probe`, { headers: { 'x-api-key': 'cmk_' + '0'.repeat(32) } })
    expect(res.status).toBe(401)
  })

  it('rejects a valid token without portal roles', async () => {
    const res = await fetch(`${base}/probe`, { headers: { authorization: `Bearer ${strangerToken}` } })
    expect(res.status).toBe(403)
  })

  it('accepts a portal-admin member', async () => {
    const res = await fetch(`${base}/probe`, { headers: { authorization: `Bearer ${adminToken}` } })
    expect(res.status).toBe(200)
  })

  it('rejects a portal-role member whose token lacks the portal scope', async () => {
    const sign = (oid: string, extra: Record<string, unknown> = {}) =>
      new SignJWT({ oid, ...extra })
        .setProtectedHeader({ alg: 'RS256' })
        .setIssuer('https://login.microsoftonline.com/tid-1/v2.0')
        .setAudience('client-1')
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(pair.privateKey)
    const noScope = await sign('oid-admin')
    const res = await fetch(`${base}/probe`, { headers: { authorization: `Bearer ${noScope}` } })
    expect(res.status).toBe(403)
    expect(((await res.json()) as { error: string }).error).toBe('portal scope required')
  })

  it('rejects garbage tokens', async () => {
    const res = await fetch(`${base}/probe`, { headers: { authorization: 'Bearer junk' } })
    expect(res.status).toBe(401)
  })
})

describe('requirePortalAdmin gate', () => {
  let gateServer: Server
  let gateBase: string
  let viewerToken: string
  let gateAdminToken: string

  beforeAll(async () => {
    await roles.upsert({
      id: 'viewer',
      name: 'Viewer',
      grants: [],
      surfaces: ['portal'],
      members: { users: ['oid-viewer'], groups: [] },
    })
    const sign = (oid: string, extra: Record<string, unknown> = {}) =>
      new SignJWT({ oid, ...extra })
        .setProtectedHeader({ alg: 'RS256' })
        .setIssuer('https://login.microsoftonline.com/tid-1/v2.0')
        .setAudience('client-1')
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(pair.privateKey)
    viewerToken = await sign('oid-viewer', { scp: 'portal.access' })
    gateAdminToken = await sign('oid-admin', { scp: 'portal.access' })

    const app = express()
    app.use(createPortalAuthMiddleware({ getValidator: () => validator, roles }))
    app.use(requirePortalAdmin)
    app.get('/probe', (_req, res) => {
      res.json({ ok: true })
    })
    app.post('/probe', (_req, res) => {
      res.json({ ok: true })
    })
    await new Promise<void>((resolve) => {
      gateServer = app.listen(0, '127.0.0.1', () => resolve())
    })
    gateBase = `http://127.0.0.1:${(gateServer.address() as { port: number }).port}`
  })

  afterAll(async () => {
    await new Promise((resolve) => gateServer.close(resolve))
  })

  it('non-admin portal role cannot mutate', async () => {
    const res = await fetch(`${gateBase}/probe`, {
      method: 'POST',
      headers: { authorization: `Bearer ${viewerToken}` },
    })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'portal admin required' })
  })

  it('non-admin portal role can still get', async () => {
    const res = await fetch(`${gateBase}/probe`, { headers: { authorization: `Bearer ${viewerToken}` } })
    expect(res.status).toBe(200)
  })

  it('portal-admin member can mutate', async () => {
    const res = await fetch(`${gateBase}/probe`, {
      method: 'POST',
      headers: { authorization: `Bearer ${gateAdminToken}` },
    })
    expect(res.status).toBe(200)
  })
})

describe('portal auth backend error', () => {
  let errorServer: Server
  let errorBase: string

  beforeAll(async () => {
    const stubRoles = {
      list: async () => {
        throw new Error('table down')
      },
    } as unknown as RolesStore

    const app = express()
    app.use(createPortalAuthMiddleware({ getValidator: () => validator, roles: stubRoles }))
    app.get('/probe', (_req, res) => {
      res.json({ ok: true })
    })
    await new Promise<void>((resolve) => {
      errorServer = app.listen(0, '127.0.0.1', () => resolve())
    })
    errorBase = `http://127.0.0.1:${(errorServer.address() as { port: number }).port}`
  })

  afterAll(async () => {
    await new Promise((resolve) => errorServer.close(resolve))
  })

  it('returns 503 on roles backend failure', async () => {
    const res = await fetch(`${errorBase}/probe`, { headers: { authorization: `Bearer ${adminToken}` } })
    expect(res.status).toBe(503)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('auth backend unavailable')
  })
})
