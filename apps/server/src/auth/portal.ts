import type { NextFunction, Request, RequestHandler, Response } from 'express'
import { logEvent } from '../logger.js'
import type { Role, RolesStore } from '../storage/roles-store.js'
import type { EntraValidator } from './entra.js'
import { rolesForPrincipal, type Principal } from './principal.js'

export const PORTAL_SCOPE = 'portal.access'
export const PORTAL_ADMIN_ROLE = 'portal-admin'

export interface PortalAuthDeps {
  getValidator(): EntraValidator | undefined
  roles: RolesStore
}

function deny(res: Response, status: number, error: string): void {
  logEvent('auth', 'portal_denied', { reason: error })
  res.status(status).json({ error })
}

export function createPortalAuthMiddleware(deps: PortalAuthDeps): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const auth = req.headers.authorization
    if (!auth?.startsWith('Bearer ')) {
      deny(res, 401, 'authentication required')
      return
    }
    const validator = deps.getValidator()
    if (!validator) {
      deny(res, 401, 'auth not configured')
      return
    }
    let claims
    try {
      claims = await validator.validate(auth.slice(7))
    } catch {
      deny(res, 401, 'invalid token')
      return
    }
    if (!claims.scopes.includes(PORTAL_SCOPE)) {
      deny(res, 403, 'portal scope required')
      return
    }
    const principal: Principal = {
      kind: 'user',
      id: `user:${claims.oid}`,
      oid: claims.oid,
      groups: claims.groups,
      name: claims.name,
    }
    let portalRoles
    try {
      portalRoles = await rolesForPrincipal(principal, deps.roles, 'portal')
    } catch (err) {
      logEvent('auth', 'portal_backend_error', { error: (err as Error).message })
      res.status(503).json({ error: 'auth backend unavailable' })
      return
    }
    if (portalRoles.length === 0) {
      deny(res, 403, 'not authorized')
      return
    }
    res.locals.principal = principal
    res.locals.portalRoles = portalRoles
    logEvent('auth', 'portal_ok', { principalId: principal.id })
    next()
  }
}

export function requirePortalAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.method === 'GET') {
    next()
    return
  }
  const roles = res.locals.portalRoles as Role[] | undefined
  if (!roles?.some((r) => r.id === PORTAL_ADMIN_ROLE)) {
    logEvent('auth', 'portal_admin_required', { path: req.path })
    res.status(403).json({ error: 'portal admin required' })
    return
  }
  next()
}
