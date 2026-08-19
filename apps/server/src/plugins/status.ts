import type { PluginManifest } from '@conduit-mcp/plugin-sdk'
import type { ConfigStore } from '../storage/config-store.js'
import type { SecretProvider } from '../secrets/provider.js'
import type { PluginRecord } from '../storage/plugin-registry.js'

export type PluginDisplayStatus = 'disabled' | 'loading' | 'quarantined' | 'needs_setup' | 'error' | 'active'

// precedence: disabled > loading > quarantined > needs_setup > error > active
export function deriveDisplayStatus(rec: PluginRecord, configured: boolean): PluginDisplayStatus {
  if (!rec.enabled) {
    return 'disabled'
  }
  if (rec.status === 'loading') {
    return 'loading'
  }
  if (rec.status === 'quarantined') {
    return 'quarantined'
  }
  if (!configured) {
    return 'needs_setup'
  }
  if (rec.health && !rec.health.ok) {
    return 'error'
  }
  return 'active'
}

// manifest missing (plugin not loaded on this replica) -> can't verify, treat as configured
export async function computeConfigured(
  manifest: PluginManifest | undefined,
  deps: { secrets: SecretProvider; config: ConfigStore },
): Promise<boolean> {
  if (!manifest) {
    return true
  }
  const required = manifest.ui.settings.filter((f) => f.required)
  if (required.length === 0) {
    return true
  }
  const needsConfig = required.some((f) => f.type !== 'secret')
  const cfg: Record<string, unknown> = needsConfig ? await deps.config.getDomain(`plugin:${manifest.id}`) : {}
  for (const field of required) {
    if (field.type === 'secret') {
      try {
        // EnvSecretProvider returns '' for an empty env var, treat that as unset like config fields do
        if ((await deps.secrets.getSecret(field.key)) === '') {
          return false
        }
      } catch {
        return false
      }
    } else {
      const value = cfg[field.key]
      if (value === undefined || value === '') {
        return false
      }
    }
  }
  return true
}
