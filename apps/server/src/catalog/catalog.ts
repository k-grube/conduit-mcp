import {
  PluginDefinitionError,
  validateAgainstManifest,
  type CompiledPlugin,
  type HealthStatus,
  type PluginContext,
  type PluginManifest,
  type ValidateResult,
} from '@conduit-mcp/plugin-sdk'

export interface CatalogNotes {
  tools: Record<string, string>
  integrations: Record<string, string>
}

export interface CatalogEntry {
  name: string
  pluginId: string
  integrationName: string
  description: string
  keywords: string[]
  readOnly: boolean
  jsonSchema: Record<string, unknown>
  notes?: string
  validate(args: unknown): ValidateResult
  invoke(data: Record<string, unknown>): Promise<unknown>
}

export interface IntegrationInfo {
  id: string
  name: string
  toolCount: number
}

export class ToolCatalog {
  private byName = new Map<string, CatalogEntry>()
  private byPlugin = new Map<
    string,
    { name: string; entries: CatalogEntry[]; manifest: PluginManifest; health?: () => Promise<HealthStatus> }
  >()
  private mutations = 0
  private notes: CatalogNotes = { tools: {}, integrations: {} }

  get version(): number {
    return this.mutations
  }

  registerPlugin(manifest: PluginManifest, plugin: CompiledPlugin, ctx: PluginContext): void {
    validateAgainstManifest(plugin, manifest)
    for (const tool of plugin.tools) {
      const owner = this.byName.get(tool.name)
      if (owner && owner.pluginId !== manifest.id) {
        throw new PluginDefinitionError(`tool ${tool.name} already owned by ${owner.pluginId}`)
      }
    }
    this.removePlugin(manifest.id)
    const entries = plugin.tools.map((tool): CatalogEntry => {
      return {
        name: tool.name,
        pluginId: manifest.id,
        integrationName: manifest.name,
        description: tool.description,
        keywords: tool.keywords ?? [],
        readOnly: tool.readOnly,
        jsonSchema: tool.jsonSchema,
        validate: (args) => tool.validate(args),
        invoke: (data) => tool.handler(data as never, ctx),
      }
    })
    for (const e of entries) {
      this.byName.set(e.name, e)
    }
    this.byPlugin.set(manifest.id, {
      name: manifest.name,
      entries,
      manifest,
      health: plugin.healthCheck ? () => plugin.healthCheck!(ctx) : undefined,
    })
    this.applyNotes()
    this.mutations++
  }

  removePlugin(pluginId: string): void {
    const existing = this.byPlugin.get(pluginId)
    if (!existing) {
      return
    }
    for (const e of existing.entries) {
      this.byName.delete(e.name)
    }
    this.byPlugin.delete(pluginId)
    this.mutations++
  }

  list(pluginId?: string): CatalogEntry[] {
    if (pluginId) {
      return [...(this.byPlugin.get(pluginId)?.entries ?? [])]
    }
    return [...this.byPlugin.values()].flatMap((p) => p.entries)
  }

  get(name: string): CatalogEntry | undefined {
    return this.byName.get(name)
  }

  getManifest(id: string): PluginManifest | undefined {
    return this.byPlugin.get(id)?.manifest
  }

  async health(id: string, timeoutMs = 5000): Promise<HealthStatus | undefined> {
    const health = this.byPlugin.get(id)?.health
    if (!health) {
      return undefined
    }
    let timer: NodeJS.Timeout | undefined
    try {
      return await Promise.race([
        health(),
        new Promise<HealthStatus>((resolve) => {
          timer = setTimeout(() => resolve({ ok: false, detail: 'health check timeout' }), timeoutMs)
        }),
      ])
    } catch (err) {
      return { ok: false, detail: (err as Error).message }
    } finally {
      clearTimeout(timer)
    }
  }

  integrations(): IntegrationInfo[] {
    return [...this.byPlugin.entries()].map(([id, p]) => ({ id, name: p.name, toolCount: p.entries.length }))
  }

  setNotes(notes: CatalogNotes): void {
    this.notes = notes
    this.applyNotes()
    this.mutations++
  }

  integrationNotes(pluginId: string): string | undefined {
    return this.notes.integrations[pluginId]
  }

  private applyNotes(): void {
    for (const [name, entry] of this.byName) {
      const text = this.notes.tools[name]
      if (text) {
        entry.notes = text
      } else {
        delete entry.notes
      }
    }
  }
}
