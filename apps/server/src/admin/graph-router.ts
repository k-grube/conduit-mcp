import { Router, type Request, type Response } from 'express'
import { logEvent } from '../logger.js'
import type { GraphClient } from './graph-client.js'

export function createGraphRouter(deps: { getGraph: () => GraphClient | undefined }): Router {
  const router = Router()

  function handler(kind: 'users' | 'groups') {
    return async (req: Request, res: Response) => {
      const graph = deps.getGraph()
      if (!graph) {
        res.status(503).json({ error: 'graph not configured' })
        return
      }
      const q = String(req.query.q ?? '')
      if (q.length < 2) {
        res.status(400).json({ error: 'q must be at least 2 chars' })
        return
      }
      if (q.length > 120) {
        res.status(400).json({ error: 'q must be at most 120 chars' })
        return
      }
      try {
        const items = kind === 'users' ? await graph.searchUsers(q) : await graph.searchGroups(q)
        res.json({ items })
      } catch (err) {
        // never echo the upstream/secret-provider error, it can carry keyvault urls and correlation ids
        logEvent('graph', 'search_failed', { error: (err as Error).message })
        res.status(502).json({ error: 'graph unavailable' })
      }
    }
  }

  router.get('/users', handler('users'))
  router.get('/groups', handler('groups'))
  return router
}
