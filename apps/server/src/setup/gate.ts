import type { RequestHandler } from 'express'

export type SetupGateAction = 'pass' | 'not-found' | 'unavailable'

const SETUP_PREFIX = '/api/setup'
const STATUS_PATH = '/api/setup/status'
const AUTH_CONFIG_PATH = '/api/admin/auth-config'

function isSetupPath(path: string): boolean {
  return path === SETUP_PREFIX || path.startsWith(SETUP_PREFIX + '/')
}

// pure branch table, mirrors craft SetupGate.Decide with setupModeRequested collapsed to !configured
export function decideSetupGate(path: string, configured: boolean): SetupGateAction {
  if (configured) {
    // wizard mutating api is gone, status stays alive for the completion poll
    if (isSetupPath(path) && path !== STATUS_PATH) {
      return 'not-found'
    }
    return 'pass'
  }
  // setup window: wizard api + the pre-msal auth-config probe stay open
  if (isSetupPath(path) || path === AUTH_CONFIG_PATH) {
    return 'pass'
  }
  // portal/plugin api has no meaning until entra is configured, hand callers a status code not an auth error
  if (path.startsWith('/api/')) {
    return 'unavailable'
  }
  // mcp keeps its own middleware (api-key path is config-independent), browser navigations fall to the static wizard
  return 'pass'
}

export function createSetupGate(getConfigured: () => boolean): RequestHandler {
  return (req, res, next) => {
    const action = decideSetupGate(req.path, getConfigured())
    if (action === 'not-found') {
      res.status(404).json({ error: 'setup complete, endpoint disabled' })
      return
    }
    if (action === 'unavailable') {
      res.status(503).json({ error: 'setup required, finish authentication setup first' })
      return
    }
    next()
  }
}
