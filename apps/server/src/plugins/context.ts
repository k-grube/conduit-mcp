import { AsyncLocalStorage } from 'node:async_hooks'
import type { PluginContext, PluginManifest } from '@conduit-mcp/plugin-sdk'
import type { ConfigStore } from '../storage/config-store.js'
import type { SecretProvider } from '../secrets/provider.js'
import type { ToolCatalog } from '../catalog/catalog.js'
import type { UsageEvent } from '../mcp/meta-tools.js'
import { allowsTool, type Permissions } from '../auth/permissions.js'
import { logEvent } from '../logger.js'
import { AdtPluginStore } from './plugin-store.js'

// tracks invokeTool nesting depth plus the originating human principal/permissions through a
// cross-plugin invoke chain, so A -> B -> A cycles still hit the depth limit and a nested invoke
// still enforces the ORIGINATING caller's grants, not the invoked plugin's own identity.
// host-only, module-scope, keyed by async context -- plugins never see this. no stashed store
// (jobs, boot, direct catalog use) means invoke is unrestricted, same as before this existed
export interface InvokeCallerContext {
  depth: number
  principalId?: string
  permissions?: Permissions
}

export const invokeCallerContext = new AsyncLocalStorage<InvokeCallerContext>()
const MAX_INVOKE_DEPTH = 4

export function createPluginContext(
  manifest: PluginManifest,
  deps: {
    secrets: SecretProvider
    config: ConfigStore
    storeTableName?: string
    getCatalog?: () => ToolCatalog
    onUsage?: (e: UsageEvent) => void
  },
): PluginContext {
  const declared = new Set(manifest.secrets)
  const component = `plugin:${manifest.id}`
  const assertDeclared = (name: string) => {
    if (!declared.has(name)) {
      throw new Error(`secret ${name} not declared in manifest for ${manifest.id}`)
    }
  }
  return {
    getSecret: async (name) => {
      assertDeclared(name)
      return deps.secrets.getSecret(name)
    },
    setSecret: async (name, value) => {
      assertDeclared(name)
      await deps.secrets.setSecret(name, value)
    },
    getConfig: async <T = Record<string, unknown>>() => deps.config.getDomain(`plugin:${manifest.id}`) as Promise<T>,
    invokeTool: async <T = unknown>(name: string, args: Record<string, unknown>): Promise<T> => {
      const caller = invokeCallerContext.getStore()
      const depth = caller?.depth ?? 0
      if (depth > MAX_INVOKE_DEPTH) {
        throw new Error('invoke_tool depth limit')
      }
      const catalog = deps.getCatalog?.()
      if (!catalog) {
        throw new Error(`invokeTool unavailable: no catalog wired for plugin ${manifest.id}`)
      }
      const entry = catalog.get(name)
      if (!entry) {
        throw new Error(`unknown tool: ${name}`)
      }
      if (caller?.permissions && !allowsTool(caller.permissions, entry)) {
        throw new Error(`not authorized for tool ${name}`)
      }
      const v = entry.validate(args)
      if (!v.ok) {
        throw new Error(`invalid args for ${name}: ${v.issues.join('; ')}`)
      }
      const started = Date.now()
      let ok = true
      let error: string | undefined
      let chars = 0
      const nextCaller: InvokeCallerContext = {
        depth: depth + 1,
        principalId: caller?.principalId,
        permissions: caller?.permissions,
      }
      // single fallback expression for the usage row's principal -- the originating human/portal
      // principal when one was stashed (mcp invoke_tool, or a plugin route dispatch), else the
      // invoking plugin's own identity (jobs, boot, direct catalog use with no ALS)
      const usagePrincipal = caller?.principalId ?? `plugin:${manifest.id}`
      try {
        const result = await invokeCallerContext.run(nextCaller, () => entry.invoke(v.data))
        chars = typeof result === 'string' ? result.length : (JSON.stringify(result) ?? 'null').length
        return result as T
      } catch (err) {
        ok = false
        error = (err as Error).message
        throw err
      } finally {
        try {
          deps.onUsage?.({
            tool: name,
            pluginId: entry.pluginId,
            principal: usagePrincipal,
            ok,
            durationMs: Date.now() - started,
            chars,
            error,
          })
        } catch {
          // usage recording is fire-and-forget, never break the caller
        }
      }
    },
    logger: {
      info: (event, data) => logEvent(component, event, data),
      warn: (event, data) => logEvent(component, `warn:${event}`, data),
      error: (event, data) => logEvent(component, `error:${event}`, data),
    },
    store: new AdtPluginStore(manifest.id, deps.storeTableName),
  }
}
