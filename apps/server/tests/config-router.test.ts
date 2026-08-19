import express from 'express'
import type { Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ConfigStore } from '../src/storage/config-store.js'
import { createConfigRouter } from '../src/admin/config-router.js'

let server: Server
let base: string
const config = new ConfigStore({ tableName: 'CfgRtT1' })

beforeAll(async () => {
  const app = express()
  app.use(express.json())
  app.use('/config', createConfigRouter({ config }))
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve())
  })
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve))
})

describe('config router', () => {
  it('round-trips the auth domain', async () => {
    const put = await fetch(`${base}/config/auth`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenantId: 'tid', clientId: 'cid', serverUrl: 'https://conduit.example.com' }),
    })
    expect(put.status).toBe(200)
    const got = await fetch(`${base}/config/auth`)
    expect(((await got.json()) as { tenantId: string }).tenantId).toBe('tid')
  })

  it('rejects invalid serverUrl', async () => {
    const res = await fetch(`${base}/config/auth`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ serverUrl: 'ftp://nope' }),
    })
    expect(res.status).toBe(400)
  })

  it('rejects a serverUrl carrying a query string or fragment', async () => {
    // the sdk's checkIssuerUrl rejects these at boot; catching it here avoids persisting a value that kills boot
    const withQuery = await fetch(`${base}/config/auth`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ serverUrl: 'https://conduit.example.com/?utm_source=email' }),
    })
    expect(withQuery.status).toBe(400)
    const withFragment = await fetch(`${base}/config/auth`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ serverUrl: 'https://conduit.example.com/#anchor' }),
    })
    expect(withFragment.status).toBe(400)
  })

  it('rejects single-label redirectHosts entries', async () => {
    const res = await fetch(`${base}/config/auth`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ redirectHosts: ['ai'] }),
    })
    expect(res.status).toBe(400)
  })

  it('accepts fully qualified and localhost redirectHosts entries', async () => {
    const res = await fetch(`${base}/config/auth`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ redirectHosts: ['claude.ai', 'localhost'] }),
    })
    expect(res.status).toBe(200)
  })

  it('404s unknown domains', async () => {
    expect((await fetch(`${base}/config/plugin:demo`)).status).toBe(404)
    expect((await fetch(`${base}/config/secrets`)).status).toBe(404)
    expect((await fetch(`${base}/config/server`)).status).toBe(404)
  })

  it('rejects non-object bodies', async () => {
    const res = await fetch(`${base}/config/auth`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify([1, 2]),
    })
    expect(res.status).toBe(400)
  })
})
