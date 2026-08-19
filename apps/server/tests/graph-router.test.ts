import express from 'express'
import type { Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { GraphClient } from '../src/admin/graph-client.js'
import { createGraphRouter } from '../src/admin/graph-router.js'

let server: Server
let base: string
let graph: GraphClient | undefined

beforeAll(async () => {
  const fakeFetch = (async (url: string | URL | Request) =>
    String(url).includes('token')
      ? new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }), { status: 200 })
      : new Response(JSON.stringify({ value: [{ id: 'u1', displayName: 'Kev' }] }), { status: 200 })) as typeof fetch
  graph = new GraphClient(
    { tenantId: 't', clientId: 'c' },
    { writable: false, getSecret: async () => 's', setSecret: async () => {} },
    fakeFetch,
  )
  const failingFetch = (async (url: string | URL | Request) =>
    String(url).includes('token')
      ? new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }), { status: 200 })
      : new Response('nope', { status: 403 })) as typeof fetch
  const failingGraph = new GraphClient(
    { tenantId: 't', clientId: 'c' },
    { writable: false, getSecret: async () => 's', setSecret: async () => {} },
    failingFetch,
  )
  const app = express()
  app.use('/graph', createGraphRouter({ getGraph: () => graph }))
  app.use('/nograph', createGraphRouter({ getGraph: () => undefined }))
  app.use('/failgraph', createGraphRouter({ getGraph: () => failingGraph }))
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve())
  })
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve))
})

describe('graph router', () => {
  it('searches users', async () => {
    const res = await fetch(`${base}/graph/users?q=ke`)
    expect(res.status).toBe(200)
    expect(((await res.json()) as { items: { id: string }[] }).items[0].id).toBe('u1')
  })

  it('rejects short queries', async () => {
    expect((await fetch(`${base}/graph/users?q=k`)).status).toBe(400)
  })

  it('rejects overly long queries', async () => {
    const res = await fetch(`${base}/graph/users?q=${'a'.repeat(121)}`)
    expect(res.status).toBe(400)
  })

  it('503 when unconfigured', async () => {
    expect((await fetch(`${base}/nograph/users?q=ke`)).status).toBe(503)
  })

  it('502s with a fixed error, never the upstream message, when the graph search throws', async () => {
    const res = await fetch(`${base}/failgraph/users?q=ke`)
    expect(res.status).toBe(502)
    expect((await res.json()) as { error: string }).toEqual({ error: 'graph unavailable' })
  })
})
