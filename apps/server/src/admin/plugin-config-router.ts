import { Router, type Request, type Response } from 'express'
import type { ConfigStore } from '../storage/config-store.js'
import type { SecretProvider } from '../secrets/provider.js'
import type { ToolCatalog } from '../catalog/catalog.js'
import type { PluginRegistryStore } from '../storage/plugin-registry.js'

export function createPluginConfigRouter(deps: {
  config: ConfigStore
  secrets: SecretProvider
  catalog: ToolCatalog
  registry: PluginRegistryStore
  refresh: (id: string) => Promise<unknown>
}): Router {
  const router = Router()

  async function known(req: Request<{ id: string }>, res: Response): Promise<boolean> {
    if (await deps.registry.get(req.params.id)) {
      return true
    }
    res.status(404).json({ error: 'unknown plugin' })
    return false
  }

  router.get('/:id/config', async (req: Request<{ id: string }>, res: Response) => {
    if (!(await known(req, res))) {
      return
    }
    res.json(await deps.config.getDomain(`plugin:${req.params.id}`))
  })

  router.put('/:id/config', async (req: Request<{ id: string }>, res: Response) => {
    if (!(await known(req, res))) {
      return
    }
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      res.status(400).json({ error: 'body must be an object' })
      return
    }
    await deps.config.updateDomain(`plugin:${req.params.id}`, req.body as Record<string, unknown>)
    await deps.refresh(req.params.id)
    res.json(await deps.config.getDomain(`plugin:${req.params.id}`))
  })

  router.get('/:id/secrets', async (req: Request<{ id: string }>, res: Response) => {
    if (!(await known(req, res))) {
      return
    }
    const manifest = deps.catalog.getManifest(req.params.id)
    if (!manifest) {
      res.status(404).json({ error: 'plugin not loaded' })
      return
    }
    const items = []
    for (const name of manifest.secrets) {
      let set = true
      try {
        await deps.secrets.getSecret(name)
      } catch {
        set = false
      }
      items.push({ name, set })
    }
    res.json({ items })
  })

  router.put('/:id/secrets', async (req: Request<{ id: string }>, res: Response) => {
    if (!(await known(req, res))) {
      return
    }
    const manifest = deps.catalog.getManifest(req.params.id)
    if (!manifest) {
      res.status(404).json({ error: 'plugin not loaded' })
      return
    }
    const body = req.body as Record<string, unknown>
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      res.status(400).json({ error: 'body must be an object' })
      return
    }
    const declared = new Set(manifest.secrets)
    for (const [name, value] of Object.entries(body)) {
      if (!declared.has(name) || typeof value !== 'string') {
        res.status(400).json({ error: `undeclared or non-string secret: ${name}` })
        return
      }
    }
    const entries = Object.entries(body)
    if (entries.length > 0 && !deps.secrets.writable) {
      res.status(409).json({ error: 'secret store is read-only, set secrets via environment variables' })
      return
    }
    for (const [name, value] of entries) {
      await deps.secrets.setSecret(name, value as string)
    }
    // empty body writes nothing, config save already triggered its own refresh
    if (entries.length > 0) {
      await deps.refresh(req.params.id)
    }
    res.status(204).end()
  })

  return router
}
