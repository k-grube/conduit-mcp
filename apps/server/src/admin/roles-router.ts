import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import type { Role, RolesStore } from '../storage/roles-store.js'
import { PORTAL_ADMIN_ROLE } from '../auth/portal.js'

export const BUILTIN_ROLE_IDS = ['portal-admin', 'admin', 'editor', 'read-only']

const GrantSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('wildcard_all') }),
  z.strictObject({
    kind: z.literal('integration'),
    integrationId: z.string().min(1),
    mode: z.enum(['read', 'write', 'all']),
  }),
  z.strictObject({ kind: z.literal('tool'), toolName: z.string().min(1) }),
  z.strictObject({ kind: z.literal('notes_write') }),
])

const MembersSchema = z.strictObject({ users: z.array(z.string()), groups: z.array(z.string()) })

export const RoleInputSchema = z.object({
  id: z
    .string()
    .regex(/^[a-z][a-z0-9-]*$/)
    .max(40),
  name: z.string().min(1).max(80),
  grants: z.array(GrantSchema),
  surfaces: z.array(z.enum(['portal', 'mcp'])).min(1),
  members: MembersSchema,
})

function bad(res: Response, error: string, status = 400): void {
  res.status(status).json({ error })
}

function sameDefinition(a: Role, b: Role): boolean {
  return (
    a.name === b.name &&
    JSON.stringify(a.grants) === JSON.stringify(b.grants) &&
    JSON.stringify(a.surfaces) === JSON.stringify(b.surfaces)
  )
}

// losing every portal-admin member locks every future admin write out (requirePortalAdmin rejects them all)
function hasNoMembers(members: { users: string[]; groups: string[] }): boolean {
  return members.users.length === 0 && members.groups.length === 0
}

export function createRolesRouter(deps: { roles: RolesStore; onChanged: () => Promise<void> }): Router {
  const router = Router()

  router.get('/', async (_req: Request, res: Response) => {
    res.json(await deps.roles.list())
  })

  router.post('/', async (req: Request, res: Response) => {
    const parsed = RoleInputSchema.safeParse(req.body)
    if (!parsed.success) {
      bad(res, parsed.error.issues[0].message)
      return
    }
    if (BUILTIN_ROLE_IDS.includes(parsed.data.id)) {
      bad(res, 'builtin role id')
      return
    }
    if (await deps.roles.get(parsed.data.id)) {
      bad(res, 'role exists', 409)
      return
    }
    await deps.roles.upsert(parsed.data)
    await deps.onChanged()
    res.status(201).json(parsed.data)
  })

  router.put('/:id', async (req: Request<{ id: string }>, res: Response) => {
    const existing = await deps.roles.get(req.params.id)
    if (!existing) {
      bad(res, 'unknown role', 404)
      return
    }
    const parsed = RoleInputSchema.safeParse({ ...req.body, id: req.params.id })
    if (!parsed.success) {
      bad(res, parsed.error.issues[0].message)
      return
    }
    if (existing.builtin && !sameDefinition(parsed.data as Role, existing)) {
      bad(res, 'builtin roles allow member updates only')
      return
    }
    if (req.params.id === PORTAL_ADMIN_ROLE && hasNoMembers(parsed.data.members)) {
      bad(res, 'portal-admin must keep at least one member')
      return
    }
    const updated: Role = { ...parsed.data, builtin: existing.builtin }
    await deps.roles.upsert(updated)
    await deps.onChanged()
    res.json(updated)
  })

  router.put('/:id/members', async (req: Request<{ id: string }>, res: Response) => {
    const existing = await deps.roles.get(req.params.id)
    if (!existing) {
      bad(res, 'unknown role', 404)
      return
    }
    const parsed = MembersSchema.safeParse(req.body)
    if (!parsed.success) {
      bad(res, parsed.error.issues[0].message)
      return
    }
    if (req.params.id === PORTAL_ADMIN_ROLE && hasNoMembers(parsed.data)) {
      bad(res, 'portal-admin must keep at least one member')
      return
    }
    const updated: Role = { ...existing, members: parsed.data }
    await deps.roles.upsert(updated)
    await deps.onChanged()
    res.json(updated)
  })

  router.delete('/:id', async (req: Request<{ id: string }>, res: Response) => {
    const existing = await deps.roles.get(req.params.id)
    if (!existing) {
      bad(res, 'unknown role', 404)
      return
    }
    if (existing.builtin) {
      bad(res, 'cannot delete builtin role')
      return
    }
    await deps.roles.remove(req.params.id)
    await deps.onChanged()
    res.status(204).end()
  })

  return router
}
