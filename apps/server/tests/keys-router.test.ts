import express from 'express'
import type { Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ApiKeysStore } from '../src/storage/api-keys-store.js'
import { RolesStore } from '../src/storage/roles-store.js'
import { createKeysRouter } from '../src/admin/keys-router.js'

let server: Server
let base: string
const apiKeys = new ApiKeysStore('KeysRtT1')
const roles = new RolesStore('KeysRtRoles')

beforeAll(async () => {
  await roles.seedBuiltins()
  const app = express()
  app.use(express.json())
  app.use('/keys', createKeysRouter({ apiKeys, roles }))
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve())
  })
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve))
})

describe('keys router', () => {
  it('creates a key and returns the raw key once', async () => {
    const res = await fetch(`${base}/keys`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'ci', roleIds: ['read-only'] }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { id: string; rawKey: string }
    expect(body.rawKey).toMatch(/^cmk_/)
    const list = await fetch(`${base}/keys`)
    const items = (await list.json()) as Record<string, unknown>[]
    expect(items).toHaveLength(1)
    expect(items[0].rawKey).toBeUndefined()
  })

  it('rejects unknown role ids', async () => {
    const res = await fetch(`${base}/keys`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x', roleIds: ['nope'] }),
    })
    expect(res.status).toBe(400)
  })

  it('deletes and 404s', async () => {
    const list = (await (await fetch(`${base}/keys`)).json()) as { id: string }[]
    expect((await fetch(`${base}/keys/${list[0].id}`, { method: 'DELETE' })).status).toBe(204)
    expect((await fetch(`${base}/keys/${list[0].id}`, { method: 'DELETE' })).status).toBe(404)
  })
})
