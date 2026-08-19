import type { NextFunction, Request, RequestHandler, Response } from 'express'
import { logEvent } from '../logger.js'
import type { ApiKeysStore } from '../storage/api-keys-store.js'
import type { EntraValidator } from './entra.js'
import type { Principal } from './principal.js'

export interface AuthDeps {
  apiKeys: ApiKeysStore
  getValidator(): EntraValidator | undefined
  resourceMetadataUrl?: () => string | undefined
}

function deny(res: Response, reason: string, metadataUrl?: string): void {
  logEvent('auth', 'denied', { reason })
  if (metadataUrl) {
    res.setHeader('WWW-Authenticate', `Bearer resource_metadata="${metadataUrl}"`)
  } else {
    res.setHeader('WWW-Authenticate', 'Bearer')
  }
  res.status(401).json({ error: reason })
}

function allow(res: Response, principal: Principal, next: NextFunction): void {
  res.locals.principal = principal
  logEvent('auth', 'ok', { principalId: principal.id, kind: principal.kind })
  next()
}

export function createAuthMiddleware(deps: AuthDeps): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const metadataUrl = deps.resourceMetadataUrl?.()
    const apiKey = (req.headers['x-api-key'] ?? req.headers['api-key']) as string | undefined
    if (apiKey) {
      let info
      try {
        info = await deps.apiKeys.verify(apiKey)
      } catch (err) {
        logEvent('auth', 'apikey_verify_error', { error: (err as Error).message })
        res.status(503).json({ error: 'auth backend unavailable' })
        return
      }
      if (!info) {
        deny(res, 'invalid api key', metadataUrl)
        return
      }
      allow(res, { kind: 'apikey', id: `apikey:${info.id}`, name: info.name, roleIds: info.roleIds }, next)
      return
    }
    const auth = req.headers.authorization
    if (auth?.startsWith('Bearer ')) {
      const validator = deps.getValidator()
      if (!validator) {
        deny(res, 'auth not configured', metadataUrl)
        return
      }
      try {
        const { oid, groups, name } = await validator.validate(auth.slice(7))
        allow(res, { kind: 'user', id: `user:${oid}`, oid, groups, name }, next)
        return
      } catch {
        deny(res, 'invalid token', metadataUrl)
        return
      }
    }
    deny(res, 'authentication required', metadataUrl)
  }
}

export function getPrincipal(res: Response): Principal {
  const p = res.locals.principal as Principal | undefined
  if (!p) {
    throw new Error('principal missing, auth middleware not applied')
  }
  return p
}
