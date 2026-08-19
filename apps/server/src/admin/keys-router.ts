import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import type { ApiKeysStore } from '../storage/api-keys-store.js'
import type { RolesStore } from '../storage/roles-store.js'

const KeyInputSchema = z.strictObject({
  name: z.string().min(1).max(80),
  roleIds: z.array(z.string()).min(1),
})

export function createKeysRouter(deps: { apiKeys: ApiKeysStore; roles: RolesStore }): Router {
  const router = Router()

  router.get('/', async (_req: Request, res: Response) => {
    res.json(await deps.apiKeys.list())
  })

  router.post('/', async (req: Request, res: Response) => {
    const parsed = KeyInputSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0].message })
      return
    }
    for (const roleId of parsed.data.roleIds) {
      if (!(await deps.roles.get(roleId))) {
        res.status(400).json({ error: `unknown role: ${roleId}` })
        return
      }
    }
    const { id, rawKey } = await deps.apiKeys.create(parsed.data.name, parsed.data.roleIds)
    res.status(201).json({ id, name: parsed.data.name, roleIds: parsed.data.roleIds, rawKey })
  })

  router.delete('/:id', async (req: Request<{ id: string }>, res: Response) => {
    const existing = (await deps.apiKeys.list()).find((k) => k.id === req.params.id)
    if (!existing) {
      res.status(404).json({ error: 'unknown key' })
      return
    }
    await deps.apiKeys.remove(req.params.id)
    res.status(204).end()
  })

  return router
}
