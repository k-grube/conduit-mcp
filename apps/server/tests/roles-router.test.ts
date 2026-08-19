import express from 'express'
import type { Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { RolesStore } from '../src/storage/roles-store.js'
import { createRolesRouter } from '../src/admin/roles-router.js'

let server: Server
let base: string
const roles = new RolesStore('RolesRtT1')
const onChanged = vi.fn(async () => {})

const customRole = {
  id: 'halo-ro',
  name: 'Halo RO',
  grants: [{ kind: 'integration', integrationId: 'halopsa', mode: 'read' }],
  surfaces: ['mcp'],
  members: { users: [], groups: [] },
}

beforeAll(async () => {
  await roles.seedBuiltins()
  const app = express()
  app.use(express.json())
  app.use('/roles', createRolesRouter({ roles, onChanged }))
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve())
  })
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve))
})

async function post(path: string, body: unknown, method = 'POST') {
  return fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('roles router', () => {
  it('lists seeded roles', async () => {
    const res = await fetch(`${base}/roles`)
    const list = (await res.json()) as { id: string }[]
    expect(list.map((r) => r.id).sort()).toEqual(['admin', 'editor', 'portal-admin', 'read-only'])
  })

  it('creates a custom role and fires onChanged', async () => {
    onChanged.mockClear()
    const res = await post('/roles', customRole)
    expect(res.status).toBe(201)
    expect(onChanged).toHaveBeenCalledOnce()
    expect((await roles.get('halo-ro'))?.name).toBe('Halo RO')
  })

  it('rejects duplicate and builtin ids', async () => {
    expect((await post('/roles', customRole)).status).toBe(409)
    expect((await post('/roles', { ...customRole, id: 'admin' })).status).toBe(400)
  })

  it('rejects invalid bodies', async () => {
    expect((await post('/roles', { ...customRole, id: 'Bad Id' })).status).toBe(400)
    expect((await post('/roles', { ...customRole, grants: [{ kind: 'nope' }] })).status).toBe(400)
    expect((await post('/roles', { ...customRole, surfaces: [] })).status).toBe(400)
  })

  it('full-updates a custom role', async () => {
    const res = await post('/roles/halo-ro', { ...customRole, name: 'Halo ReadOnly' }, 'PUT')
    expect(res.status).toBe(200)
    expect((await roles.get('halo-ro'))?.name).toBe('Halo ReadOnly')
  })

  it('builtin update allows members only', async () => {
    const admin = (await roles.get('admin'))!
    const membersOnly = { ...admin, members: { users: ['oid-x'], groups: [] } }
    expect((await post('/roles/admin', membersOnly, 'PUT')).status).toBe(200)
    const grantChange = { ...admin, grants: [], members: { users: ['oid-x'], groups: [] } }
    expect((await post('/roles/admin', grantChange, 'PUT')).status).toBe(400)
  })

  it('members endpoint replaces members', async () => {
    onChanged.mockClear()
    const res = await post('/roles/admin/members', { users: ['oid-y'], groups: ['g9'] }, 'PUT')
    expect(res.status).toBe(200)
    expect((await roles.get('admin'))?.members).toEqual({ users: ['oid-y'], groups: ['g9'] })
    expect(onChanged).toHaveBeenCalledOnce()
  })

  it('rejects a full update that leaves portal-admin with zero members', async () => {
    const portalAdmin = (await roles.get('portal-admin'))!
    const emptied = { ...portalAdmin, members: { users: [], groups: [] } }
    const res = await post('/roles/portal-admin', emptied, 'PUT')
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'portal-admin must keep at least one member' })
  })

  it('rejects a members-endpoint update that leaves portal-admin with zero members', async () => {
    // seed a member first so removal (not "still empty") is what gets rejected
    await post('/roles/portal-admin/members', { users: ['oid-1'], groups: [] }, 'PUT')
    const res = await post('/roles/portal-admin/members', { users: [], groups: [] }, 'PUT')
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'portal-admin must keep at least one member' })
    expect((await roles.get('portal-admin'))?.members).toEqual({ users: ['oid-1'], groups: [] })
  })

  it('deletes custom, refuses builtin, 404s unknown', async () => {
    expect((await post('/roles/halo-ro', {}, 'DELETE')).status).toBe(204)
    expect((await post('/roles/admin', {}, 'DELETE')).status).toBe(400)
    expect((await post('/roles/nope', {}, 'DELETE')).status).toBe(404)
  })

  it('accepts a notes_write grant', async () => {
    const res = await post('/roles', {
      id: 'note-writers',
      name: 'Note Writers',
      grants: [{ kind: 'notes_write' }],
      surfaces: ['mcp'],
      members: { users: [], groups: [] },
    })
    expect(res.status).toBe(201)
    expect((await roles.get('note-writers'))?.grants).toEqual([{ kind: 'notes_write' }])
  })
})
