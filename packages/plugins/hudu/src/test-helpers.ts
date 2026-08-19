import type { PluginContext, PluginStore } from '@conduit-mcp/plugin-sdk'

export function fakeStore(): PluginStore {
  const data = new Map<string, unknown>()
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

export function fakeCtx(
  opts: {
    secrets?: Record<string, string>
    config?: Record<string, unknown>
    invokeTool?: (name: string, args: Record<string, unknown>) => Promise<unknown>
  } = {},
): PluginContext {
  const secrets = opts.secrets ?? { HUDU_API_KEY: 'test-key' }
  const config = { baseUrl: 'https://hudu.example.com', ...(opts.config ?? {}) }
  return {
    getSecret: async (name) => {
      const v = secrets[name]
      if (v === undefined) {
        throw new Error(`missing secret ${name}`)
      }
      return v
    },
    setSecret: async () => {},
    getConfig: async <T>() => config as T,
    invokeTool: (opts.invokeTool ??
      (async () => {
        throw new Error('invokeTool not stubbed')
      })) as PluginContext['invokeTool'],
    logger: { info() {}, warn() {}, error() {} },
    store: fakeStore(),
  }
}
