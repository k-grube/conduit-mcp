export interface PluginLogger {
  info(event: string, data?: Record<string, unknown>): void
  warn(event: string, data?: Record<string, unknown>): void
  error(event: string, data?: Record<string, unknown>): void
}

export interface PluginStore {
  get<T = unknown>(key: string): Promise<T | undefined>
  set(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<void>
}

export interface PluginContext {
  getSecret(name: string): Promise<string>
  setSecret(name: string, value: string): Promise<void>
  getConfig<T = Record<string, unknown>>(): Promise<T>
  invokeTool<T = unknown>(name: string, args: Record<string, unknown>): Promise<T>
  logger: PluginLogger
  store: PluginStore
}
