import type { RolesStore } from '../storage/roles-store.js'
import type { ConfigStore } from '../storage/config-store.js'
import { logEvent } from '../logger.js'

export async function ensureBootstrapAdmin(roles: RolesStore, oid: string | undefined): Promise<void> {
  if (!oid) {
    return
  }
  for (const roleId of ['admin', 'portal-admin']) {
    const role = await roles.get(roleId)
    if (role && !role.members.users.includes(oid)) {
      await roles.upsert({ ...role, members: { ...role.members, users: [...role.members.users, oid] } })
      logEvent('auth', 'bootstrap_admin_added', { roleId })
    }
  }
}

// config put stays the authoritative editor once set, this only fills blank fields at boot.
// tenantId/clientId and serverUrl seed independently so a bicep run with only the webapp
// hostname known (entra app not registered yet) still gets serverUrl in before the entra script runs
export async function seedAuthFromEnv(config: ConfigStore, env: NodeJS.ProcessEnv): Promise<void> {
  const auth = await config.getDomain<{ tenantId?: string; clientId?: string; serverUrl?: string }>('auth')
  const patch: Record<string, unknown> = {}
  if (!auth.tenantId && !auth.clientId && env.ENTRA_TENANT_ID && env.ENTRA_CLIENT_ID) {
    patch.tenantId = env.ENTRA_TENANT_ID
    patch.clientId = env.ENTRA_CLIENT_ID
  }
  if (!auth.serverUrl && env.CONDUIT_SERVER_URL) {
    patch.serverUrl = env.CONDUIT_SERVER_URL
  }
  if (Object.keys(patch).length === 0) {
    return
  }
  await config.updateDomain('auth', patch)
  logEvent('auth', 'auth_seeded_from_env', {})
}
