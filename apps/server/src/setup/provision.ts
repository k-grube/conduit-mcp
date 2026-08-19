import type { SetupSession, SetupStepId, SetupStepState } from './session.js'
import {
  createAppSecret,
  ensureApp,
  ensureCredentialPolicyExemption,
  ensureServicePrincipal,
  findGraphServicePrincipalId,
  grantAdminConsent,
  GraphError,
  patchManifest,
} from './graph-app.js'
import { ensureBootstrapAdmin } from '../auth/bootstrap.js'
import type { ConfigStore } from '../storage/config-store.js'
import type { RolesStore } from '../storage/roles-store.js'
import type { SecretProvider } from '../secrets/provider.js'
import { logEvent } from '../logger.js'

export interface ProvisionDeps {
  config: ConfigStore
  secrets: SecretProvider
  roles: RolesStore
  fetchFn?: typeof fetch
  secretDelaysMs?: number[] // test hook, forwarded to createAppSecret
}

export async function runProvision(
  session: SetupSession,
  displayName: string,
  serverUrl: string | undefined,
  deps: ProvisionDeps,
): Promise<void> {
  const token = session.accessToken
  const user = session.user
  const step = (id: SetupStepId) => session.steps.find((s) => s.id === id)!
  const mark = (id: SetupStepId, state: SetupStepState['state'], detail?: string) => {
    const s = step(id)
    s.state = state
    if (detail !== undefined) {
      s.detail = detail
    }
  }
  let current: SetupStepId = 'app'
  let succeeded = false
  try {
    if (!token || !user) {
      throw new Error('session not authenticated')
    }
    mark('app', 'active')
    const app = await ensureApp(token, displayName, deps.fetchFn)
    mark('app', 'done')

    current = 'manifest'
    mark('manifest', 'active')
    await patchManifest(token, app, serverUrl, deps.fetchFn)
    mark('manifest', 'done')

    current = 'sp'
    mark('sp', 'active')
    const spObjectId = await ensureServicePrincipal(token, app.clientId, deps.fetchFn)
    mark('sp', 'done')

    current = 'consent'
    mark('consent', 'active')
    const graphSpId = await findGraphServicePrincipalId(token, deps.fetchFn)
    const consentGranted = await grantAdminConsent(token, spObjectId, graphSpId, deps.fetchFn)
    const consentCommand = 'az ad app permission admin-consent --id ' + app.clientId
    if (consentGranted) {
      mark('consent', 'done')
    } else {
      mark('consent', 'done', 'admin consent required, run the command shown after setup')
    }

    current = 'secret'
    mark('secret', 'active')
    await ensureCredentialPolicyExemption(token, app, deps.fetchFn)
    const secret = await createAppSecret(token, app.appObjectId, displayName, deps.fetchFn, deps.secretDelaysMs)
    mark('secret', 'done')

    current = 'store'
    mark('store', 'active')
    let secretStored: 'keyvault' | 'shown'
    if (deps.secrets.writable) {
      await deps.secrets.setSecret('AZURE_CLIENT_SECRET', secret)
      secretStored = 'keyvault'
    } else {
      secretStored = 'shown'
    }
    mark('store', 'done')

    current = 'admin'
    mark('admin', 'active')
    await ensureBootstrapAdmin(deps.roles, user.oid)
    mark('admin', 'done')

    session.result = {
      tenantId: user.tid,
      clientId: app.clientId,
      consentGranted,
      ...(consentGranted ? {} : { consentCommand }),
      secretStored,
      ...(secretStored === 'shown' ? { clientSecret: secret } : {}),
    }

    current = 'config'
    mark('config', 'active')
    await deps.config.updateDomain('auth', { tenantId: user.tid, clientId: app.clientId })
    mark('config', 'done')

    logEvent('setup', 'provision_complete', { clientId: app.clientId })
    succeeded = true
  } catch (err) {
    // graph error bodies can carry tenant/app detail, status served unauthenticated from session.error - full message stays in the log only
    const detail = err instanceof GraphError ? `graph request failed (${err.status})` : (err as Error).message
    mark(current, 'error', detail)
    session.error = detail
    logEvent('setup', 'provision_failed', { step: current, error: (err as Error).message })
  } finally {
    session.provisioning = false
    if (succeeded) {
      // keep the token on failure so POST /api/setup/provision can retry, TTL still bounds its life
      session.accessToken = undefined
    }
  }
}
