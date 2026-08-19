import express from 'express'
import { randomUUID } from 'node:crypto'
import type { Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createSetupRouter } from './router.js'
import { SetupService } from './service.js'
import { SetupSessionStore } from './session.js'
import type { ConfigStore } from '../storage/config-store.js'
import type { RolesStore } from '../storage/roles-store.js'

function jsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) }
}

function makeConfig(initial: Record<string, unknown> = {}) {
  const auth: Record<string, unknown> = { ...initial }
  const getDomain = vi.fn(async () => structuredClone(auth))
  const updateDomain = vi.fn(async () => {})
  return { getDomain, updateDomain } as unknown as ConfigStore
}

function makeRoles() {
  return { get: vi.fn(), upsert: vi.fn() } as unknown as RolesStore
}

function makeSecrets() {
  return { writable: true, setSecret: vi.fn(async () => {}), getSecret: vi.fn(async () => '') }
}

let server: Server
let base: string
let expiredToken = ''

beforeAll(async () => {
  const unconfigured = new SetupService({
    config: makeConfig(),
    secrets: makeSecrets(),
    roles: makeRoles(),
    sessions: new SetupSessionStore(),
  })

  const configured = new SetupService({
    config: makeConfig({ tenantId: 'tid-1', clientId: 'cid-1' }),
    secrets: makeSecrets(),
    roles: makeRoles(),
    sessions: new SetupSessionStore(),
  })

  const expiredSessions = new SetupSessionStore()
  expiredToken = expiredSessions.start('dc-1', 5).token
  const expiredFetch = vi.fn(async (url: string) => {
    if (String(url).includes('/oauth2/v2.0/token')) {
      return jsonResponse(400, { error: 'expired_token' })
    }
    throw new Error(`unhandled fetch: ${url}`)
  }) as unknown as typeof fetch
  const expiredCode = new SetupService({
    config: makeConfig(),
    secrets: makeSecrets(),
    roles: makeRoles(),
    sessions: expiredSessions,
    fetchFn: expiredFetch,
  })

  const brokenConfig = {
    getDomain: vi.fn(async () => {
      throw new Error('upstream stack trace with tenant secrets should never reach the client')
    }),
    updateDomain: vi.fn(async () => {}),
  } as unknown as ConfigStore
  const broken = new SetupService({
    config: brokenConfig,
    secrets: makeSecrets(),
    roles: makeRoles(),
    sessions: new SetupSessionStore(),
  })

  const app = express()
  app.use(express.json())
  app.use('/unconfigured', createSetupRouter(unconfigured))
  app.use('/configured', createSetupRouter(configured))
  app.use('/expiredcode', createSetupRouter(expiredCode))
  app.use('/broken', createSetupRouter(broken))

  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve())
  })
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve))
})

describe('setup router', () => {
  it('status is 200 while unconfigured', async () => {
    const res = await fetch(`${base}/unconfigured/status`)
    expect(res.status).toBe(200)
    expect(((await res.json()) as { configured: boolean }).configured).toBe(false)
  })

  it('status is 200 while configured, never 409', async () => {
    const res = await fetch(`${base}/configured/status`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ configured: true })
  })

  it('device-code is 409 once configured', async () => {
    const res = await fetch(`${base}/configured/device-code`, { method: 'POST' })
    expect(res.status).toBe(409)
  })

  it('poll is 409 once configured', async () => {
    const res = await fetch(`${base}/configured/poll`, { method: 'POST' })
    expect(res.status).toBe(409)
  })

  it('provision is 409 once configured', async () => {
    const res = await fetch(`${base}/configured/provision`, { method: 'POST' })
    expect(res.status).toBe(409)
  })

  it('manual is 409 once configured', async () => {
    const res = await fetch(`${base}/configured/manual`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenantId: randomUUID(), clientId: randomUUID() }),
    })
    expect(res.status).toBe(409)
  })

  it('poll with an expired device code is 410', async () => {
    const res = await fetch(`${base}/expiredcode/poll`, {
      method: 'POST',
      headers: { 'x-setup-token': expiredToken },
    })
    expect(res.status).toBe(410)
  })

  it('poll without the setup token is 401', async () => {
    const res = await fetch(`${base}/expiredcode/poll`, { method: 'POST' })
    expect(res.status).toBe(401)
  })

  it('provision while unauthenticated is 401', async () => {
    const res = await fetch(`${base}/unconfigured/provision`, { method: 'POST' })
    expect(res.status).toBe(401)
  })

  it('manual with a non-uuid tenantId/clientId is 400', async () => {
    const res = await fetch(`${base}/unconfigured/manual`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenantId: 'not-a-uuid', clientId: 'not-a-uuid' }),
    })
    expect(res.status).toBe(400)
  })

  it('an internal error is 500 with a generic body, never the upstream message', async () => {
    const res = await fetch(`${base}/broken/status`)
    expect(res.status).toBe(500)
    const text = await res.text()
    expect(text).not.toContain('upstream stack trace')
    expect(text).not.toContain('tenant secrets')
    expect(JSON.parse(text)).toEqual({ error: 'internal error' })
  })
})
