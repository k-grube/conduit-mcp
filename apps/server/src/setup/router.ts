import { Router, type NextFunction, type Request, type Response } from 'express'
import { z, ZodError } from 'zod'
import {
  AlreadyConfiguredError,
  ManualValidationError,
  NotAuthenticatedError,
  OidMismatchError,
  ProvisionInProgressError,
  type SetupService,
} from './service.js'
import { DeviceCodeExpiredError } from './device-code.js'
import { logEvent } from '../logger.js'

const provisionSchema = z.object({ displayName: z.string().min(1).max(120).optional() })
const manualSchema = z.object({
  tenantId: z.string().uuid(),
  clientId: z.string().uuid(),
  clientSecret: z.string().min(1).optional(),
})

export function createSetupRouter(service: SetupService): Router {
  const router = Router()

  router.get('/status', async (req: Request, res: Response) => {
    res.json(await service.status(req.header('x-setup-token')))
  })

  router.post('/device-code', async (_req: Request, res: Response) => {
    res.json(await service.start())
  })

  router.post('/poll', async (req: Request, res: Response) => {
    res.json(await service.poll(req.header('x-setup-token')))
  })

  router.post('/provision', async (req: Request, res: Response) => {
    const parsed = provisionSchema.parse(req.body ?? {})
    await service.provision(req.header('x-setup-token'), parsed.displayName)
    res.status(202).json({ ok: true })
  })

  router.post('/manual', async (req: Request, res: Response) => {
    const parsed = manualSchema.parse(req.body)
    const { warning } = await service.manual(req.header('x-setup-token'), parsed)
    res.json({ ok: true, ...(warning ? { warning } : {}) })
  })

  // express 5 forwards async rejections here automatically
  router.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AlreadyConfiguredError) {
      res.status(409).json({ error: err.message })
      return
    }
    if (err instanceof NotAuthenticatedError) {
      res.status(401).json({ error: err.message })
      return
    }
    if (err instanceof OidMismatchError) {
      res.status(403).json({ error: err.message })
      return
    }
    if (err instanceof DeviceCodeExpiredError) {
      res.status(410).json({ error: err.message })
      return
    }
    if (err instanceof ProvisionInProgressError) {
      res.status(409).json({ error: err.message })
      return
    }
    if (err instanceof ManualValidationError) {
      res.status(400).json({ error: err.message })
      return
    }
    if (err instanceof ZodError) {
      res.status(400).json({ error: err.issues[0].message })
      return
    }
    // never echo raw graph/upstream bodies to an unauthenticated caller
    logEvent('setup', 'endpoint_error', { error: (err as Error).message })
    res.status(500).json({ error: 'internal error' })
  })

  return router
}
