import type { PluginContext, PluginStore } from '@conduit-mcp/plugin-sdk'
import { getQboClient } from './client.js'

export function fakeStore(initial?: Record<string, unknown>): PluginStore {
  const data = new Map<string, unknown>(Object.entries(initial ?? {}))
  return {
    async get<T>(key: string) {
      return data.get(key) as T | undefined
    },
    async set(key: string, value: unknown) {
      data.set(key, value)
    },
    async delete(key: string) {
      data.delete(key)
    },
  }
}

export interface FakeCtxOpts {
  secrets?: Record<string, string>
  config?: Record<string, unknown>
  store?: PluginStore
  // plain (non-generic) shape so test call sites can pass a simple lambda; cast to the sdk's
  // generic invokeTool type below
  invokeTool?: (name: string, args: Record<string, unknown>) => Promise<unknown>
  setSecret?: PluginContext['setSecret']
}

export function fakeCtx(opts: FakeCtxOpts = {}): PluginContext {
  const secrets = { ...(opts.secrets ?? {}) }
  return {
    getSecret: async (name) => {
      const v = secrets[name]
      if (v === undefined) {
        throw new Error(`missing secret ${name}`)
      }
      return v
    },
    setSecret:
      opts.setSecret ??
      (async (name, value) => {
        secrets[name] = value
      }),
    getConfig: async <T>() => (opts.config ?? {}) as T,
    invokeTool: (opts.invokeTool ??
      (async () => {
        throw new Error('invokeTool not stubbed')
      })) as PluginContext['invokeTool'],
    logger: { info() {}, warn() {}, error() {} },
    store: opts.store ?? fakeStore(),
  }
}

// tool handlers resolve getQboClient(ctx) with no fetchFn of their own -- seed the module-scope
// cache once with a fake fetchFn (call resetQboClient() in beforeEach first) so the handler's own
// lookup returns the already-cached, fetchFn-bound client
export async function seedQboClient(ctx: PluginContext, fetchFn: typeof fetch): Promise<void> {
  await getQboClient(ctx, fetchFn)
}

// simulates a transient store outage scoped to one key prefix (e.g. the "state:<env>" bookkeeping
// key) while leaving other keys (e.g. oauth nonces) writable, for resilience tests
export function fakeStoreWithFailingSet(prefix: string, initial?: Record<string, unknown>): PluginStore {
  const store = fakeStore(initial)
  return {
    ...store,
    set: async (key: string, value: unknown) => {
      if (key.startsWith(prefix)) {
        throw new Error(`store set failed for ${key}`)
      }
      await store.set(key, value)
    },
  }
}
