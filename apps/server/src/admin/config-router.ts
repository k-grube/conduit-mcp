import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import type { ConfigStore } from '../storage/config-store.js'

export const CONFIG_DOMAINS = ['auth', 'retention'] as const
type ConfigDomain = (typeof CONFIG_DOMAINS)[number]

function isConfigDomain(domain: string): domain is ConfigDomain {
  return (CONFIG_DOMAINS as readonly string[]).includes(domain)
}

const serverUrlSchema = z.string().refine((v) => {
  try {
    const u = new URL(v)
    // sdk's checkIssuerUrl rejects a query string or fragment on the issuer url, reject here too
    if (u.search || u.hash) {
      return false
    }
    return u.protocol === 'https:' || (u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname))
  } catch {
    return false
  }
}, 'serverUrl must be https (or http on localhost), no query string or fragment')

// single-label entries would widen the allowlist to a whole tld via the suffix match in hostAllowed
const redirectHostSchema = z
  .string()
  .min(1)
  .refine((h) => h === 'localhost' || h.includes('.'), 'redirectHosts entries must be fully qualified or "localhost"')

// auth domain also carries operator keys, passthrough so a partial PUT never drops them
const authSchema = z
  .strictObject({
    tenantId: z.string().min(1).optional(),
    clientId: z.string().min(1).optional(),
    serverUrl: serverUrlSchema.optional(),
    redirectHosts: z.array(redirectHostSchema).optional(),
  })
  .passthrough()

const retentionSchema = z.strictObject({
  usageDays: z.number().optional(),
  sessionDays: z.number().optional(),
  eventDays: z.number().optional(),
  dcrDays: z.number().optional(),
})

const DOMAIN_SCHEMAS: Record<ConfigDomain, z.ZodType<Record<string, unknown>>> = {
  auth: authSchema,
  retention: retentionSchema,
}

export function createConfigRouter(deps: { config: ConfigStore }): Router {
  const router = Router()

  router.get('/:domain', async (req: Request<{ domain: string }>, res: Response) => {
    const domain = req.params.domain
    if (!isConfigDomain(domain)) {
      res.status(404).json({ error: 'unknown config domain' })
      return
    }
    res.json(await deps.config.getDomain(domain))
  })

  router.put('/:domain', async (req: Request<{ domain: string }>, res: Response) => {
    const domain = req.params.domain
    if (!isConfigDomain(domain)) {
      res.status(404).json({ error: 'unknown config domain' })
      return
    }
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      res.status(400).json({ error: 'body must be an object' })
      return
    }
    const parsed = DOMAIN_SCHEMAS[domain].safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0].message })
      return
    }
    await deps.config.updateDomain(domain, parsed.data)
    res.json(await deps.config.getDomain(domain))
  })

  return router
}
