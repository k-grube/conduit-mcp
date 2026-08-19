import { Router, type Request, type Response } from 'express'
import { DefaultAzureCredential } from '@azure/identity'
import type { TokenCredential } from '@azure/identity'
import { logEvent } from '../logger.js'
import type { Principal } from '../auth/principal.js'
import { createUpdateCache, restartSite, type UpdateCache } from './system.js'

export interface SystemRouterDeps {
  env?: NodeJS.ProcessEnv
  fetchFn?: typeof fetch
  credential?: () => TokenCredential
  updates?: UpdateCache
}

export function createSystemRouter(deps: SystemRouterDeps = {}): Router {
  const router = Router()
  const env = deps.env ?? process.env
  const fetchFn = deps.fetchFn ?? fetch
  const updates = deps.updates ?? createUpdateCache(env, fetchFn)
  // lazy: DefaultAzureCredential probes the environment, only pay for it on first restart
  let credential: TokenCredential | undefined

  // ?live=1 forces the registry round trip ("check again" button), default serves the shared cache
  router.get('/update', async (req: Request, res: Response) => {
    try {
      res.json(await (req.query.live ? updates.check() : updates.get()))
    } catch (err) {
      res.status(502).json({ error: (err as Error).message })
    }
  })

  router.post('/restart', async (_req: Request, res: Response) => {
    credential = credential ?? (deps.credential ?? (() => new DefaultAzureCredential()))()
    const principal = res.locals.principal as Principal | undefined
    try {
      logEvent('admin', 'restart_requested', { principal: principal?.id ?? 'unknown' })
      await restartSite(env, credential, fetchFn)
      res.json({ ok: true })
    } catch (err) {
      logEvent('admin', 'restart_failed', { error: (err as Error).message })
      res.status(502).json({ error: (err as Error).message })
    }
  })

  return router
}
