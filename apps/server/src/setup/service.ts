import type { ConfigStore } from '../storage/config-store.js'
import type { SecretProvider } from '../secrets/provider.js'
import type { RolesStore } from '../storage/roles-store.js'
import { ensureBootstrapAdmin } from '../auth/bootstrap.js'
import { SetupSessionStore, freshSteps, tokenMatches, type SetupStepState, type SetupResult } from './session.js'
import { DEFAULT_BOOTSTRAP_CLIENT_ID, pollDeviceCode, startDeviceCode } from './device-code.js'
import { runProvision } from './provision.js'
import { logEvent } from '../logger.js'

export class AlreadyConfiguredError extends Error {
  constructor() {
    super('setup already configured')
    this.name = 'AlreadyConfiguredError'
  }
}

export class NotAuthenticatedError extends Error {
  constructor() {
    super('not authenticated')
    this.name = 'NotAuthenticatedError'
  }
}

export class OidMismatchError extends Error {
  constructor() {
    super('signed-in account does not match the bootstrap admin')
    this.name = 'OidMismatchError'
  }
}

export class ProvisionInProgressError extends Error {
  constructor() {
    super('provisioning already in progress')
    this.name = 'ProvisionInProgressError'
  }
}

export class ManualValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ManualValidationError'
  }
}

export interface SetupStatusSession {
  authenticated: boolean
  user?: { name?: string; upn?: string }
  provisioning: boolean
  steps: SetupStepState[]
  result?: SetupResult
  error?: string
}

export interface SetupStatus {
  configured: boolean
  serverUrl?: string
  oidLockActive?: boolean
  secretsWritable?: boolean
  session?: SetupStatusSession
}

export interface SetupServiceDeps {
  config: ConfigStore
  secrets: SecretProvider
  roles: RolesStore
  sessions: SetupSessionStore
  bootstrapAdminOid?: string
  bootstrapClientId?: string
  fetchFn?: typeof fetch
  secretDelaysMs?: number[]
}

type AuthDomain = { tenantId?: string; clientId?: string; serverUrl?: string }

export class SetupService {
  private deps: SetupServiceDeps

  constructor(deps: SetupServiceDeps) {
    this.deps = deps
  }

  private async auth(): Promise<AuthDomain> {
    return this.deps.config.getDomain<AuthDomain>('auth')
  }

  private async requireUnconfigured(): Promise<void> {
    const auth = await this.auth()
    if (auth.tenantId && auth.clientId) {
      throw new AlreadyConfiguredError()
    }
  }

  async status(token?: string): Promise<SetupStatus> {
    const auth = await this.auth()
    const configured = Boolean(auth.tenantId && auth.clientId)
    const session = this.deps.sessions.get()
    if (configured && !session) {
      return { configured: true }
    }
    // the session block carries the signer identity, provision steps, and the one-time client
    // secret; return it only to the caller holding the setup token that started the flow
    return {
      configured,
      ...(auth.serverUrl ? { serverUrl: auth.serverUrl } : {}),
      oidLockActive: Boolean(this.deps.bootstrapAdminOid),
      secretsWritable: this.deps.secrets.writable,
      session:
        session && tokenMatches(token, session)
          ? {
              authenticated: Boolean(session.user),
              ...(session.user ? { user: { name: session.user.name, upn: session.user.upn } } : {}),
              provisioning: session.provisioning,
              steps: session.steps,
              ...(session.result ? { result: session.result } : {}),
              ...(session.error ? { error: session.error } : {}),
            }
          : undefined,
    }
  }

  async start(): Promise<{
    userCode: string
    verificationUri: string
    expiresIn: number
    message: string
    setupToken: string
  }> {
    await this.requireUnconfigured()
    const clientId = this.deps.bootstrapClientId ?? DEFAULT_BOOTSTRAP_CLIENT_ID
    const started = await startDeviceCode(clientId, this.deps.fetchFn)
    const session = this.deps.sessions.start(started.deviceCode, started.interval)
    return {
      userCode: started.userCode,
      verificationUri: started.verificationUri,
      expiresIn: started.expiresIn,
      message: started.message,
      setupToken: session.token,
    }
  }

  async poll(token?: string): Promise<{ pending: true } | { pending: false; user: { name?: string; upn?: string } }> {
    await this.requireUnconfigured()
    const session = this.deps.sessions.get()
    if (!session || !tokenMatches(token, session)) {
      throw new NotAuthenticatedError()
    }
    if (session.user) {
      return { pending: false, user: { name: session.user.name, upn: session.user.upn } }
    }
    const clientId = this.deps.bootstrapClientId ?? DEFAULT_BOOTSTRAP_CLIENT_ID
    const result = await pollDeviceCode(clientId, session.deviceCode, this.deps.fetchFn)
    if (result.pending) {
      return { pending: true }
    }
    if (this.deps.bootstrapAdminOid && result.user.oid !== this.deps.bootstrapAdminOid) {
      this.deps.sessions.clear()
      logEvent('setup', 'oid_lock_rejected', { oid: result.user.oid })
      throw new OidMismatchError()
    }
    session.accessToken = result.accessToken
    session.user = result.user
    logEvent('setup', 'signer_authenticated', { oid: result.user.oid, tid: result.user.tid, upn: result.user.upn })
    return { pending: false, user: { name: result.user.name, upn: result.user.upn } }
  }

  async provision(token: string | undefined, displayName?: string): Promise<void> {
    await this.requireUnconfigured()
    const session = this.deps.sessions.get()
    if (!session || !tokenMatches(token, session) || !session.accessToken) {
      throw new NotAuthenticatedError()
    }
    if (session.provisioning) {
      throw new ProvisionInProgressError()
    }
    session.provisioning = true
    session.steps = freshSteps()
    session.error = undefined
    session.result = undefined
    const auth = await this.auth()
    // fire and forget, progress is read back via status() while the session lives
    void runProvision(session, displayName?.trim() || 'conduit-mcp', auth.serverUrl, {
      config: this.deps.config,
      secrets: this.deps.secrets,
      roles: this.deps.roles,
      fetchFn: this.deps.fetchFn,
      secretDelaysMs: this.deps.secretDelaysMs,
    })
  }

  async manual(
    token: string | undefined,
    input: { tenantId: string; clientId: string; clientSecret?: string },
  ): Promise<{ warning?: string }> {
    await this.requireUnconfigured()
    const session = this.deps.sessions.get()
    // a live device-code session may only be driven by the caller that started it
    if (session && !tokenMatches(token, session)) {
      throw new NotAuthenticatedError()
    }
    const verifiedUser = session?.user
    if (this.deps.bootstrapAdminOid && !verifiedUser) {
      throw new NotAuthenticatedError()
    }
    const fetchFn = this.deps.fetchFn ?? fetch
    const wellKnown = await fetchFn(
      `https://login.microsoftonline.com/${input.tenantId}/v2.0/.well-known/openid-configuration`,
    )
    if (!wellKnown.ok) {
      throw new ManualValidationError('tenant not found')
    }
    let warning: string | undefined
    if (input.clientSecret && this.deps.secrets.writable) {
      const tokenRes = await fetchFn(`https://login.microsoftonline.com/${input.tenantId}/oauth2/v2.0/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: input.clientId,
          client_secret: input.clientSecret,
          scope: 'https://graph.microsoft.com/.default',
        }),
      })
      if (!tokenRes.ok) {
        const body = await tokenRes.text()
        if (body.includes('7000215') || body.includes('700016')) {
          throw new ManualValidationError('entra rejected the client secret')
        }
        warning = 'secret stored but could not be verified against entra'
      }
      await this.deps.secrets.setSecret('AZURE_CLIENT_SECRET', input.clientSecret)
    } else if (input.clientSecret) {
      warning = 'secret not stored, this deployment reads AZURE_CLIENT_SECRET from the environment'
    }
    if (verifiedUser) {
      await ensureBootstrapAdmin(this.deps.roles, verifiedUser.oid)
    }
    await this.deps.config.updateDomain('auth', { tenantId: input.tenantId, clientId: input.clientId })
    logEvent('setup', 'manual_configured', {
      tenantId: input.tenantId,
      clientId: input.clientId,
      seededAdmin: Boolean(session?.user),
    })
    this.deps.sessions.clear()
    return { warning }
  }
}
