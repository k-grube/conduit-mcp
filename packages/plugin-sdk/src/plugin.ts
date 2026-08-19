import type { Router } from 'express'
import { z } from 'zod'
import type { PluginContext } from './context.js'
import type { PluginManifest } from './manifest.js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface ToolDef<S extends z.ZodRawShape = any> {
  name: string
  description: string
  keywords?: string[]
  params: S
  readOnly: boolean
  handler(args: z.infer<z.ZodObject<S>>, ctx: PluginContext): Promise<unknown>
}

export interface JobDef {
  name: string
  intervalMs: number
  run: (ctx: PluginContext) => Promise<void>
}

export interface HealthStatus {
  ok: boolean
  detail?: string
}

export interface PluginDefinition {
  tools: ToolDef[]
  // routes declared public in the manifest run unauthenticated, no req/res.locals.principal or portalRoles
  routes?: (router: Router, ctx: PluginContext) => void
  jobs?: JobDef[]
  onLoad?: (ctx: PluginContext) => Promise<void>
  healthCheck?: (ctx: PluginContext) => Promise<HealthStatus>
}

export class PluginDefinitionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PluginDefinitionError'
  }
}

export type ValidateResult = { ok: true; data: Record<string, unknown> } | { ok: false; issues: string[] }

export interface CompiledTool extends ToolDef {
  jsonSchema: Record<string, unknown>
  validate(args: unknown): ValidateResult
}

export interface CompiledPlugin extends PluginDefinition {
  tools: CompiledTool[]
}

function compileTool(tool: ToolDef): CompiledTool {
  const schema = z.object(tool.params)
  return {
    ...tool,
    jsonSchema: z.toJSONSchema(schema) as Record<string, unknown>,
    validate(args: unknown): ValidateResult {
      const r = schema.safeParse(args ?? {})
      if (r.success) {
        return { ok: true, data: r.data as Record<string, unknown> }
      }
      return { ok: false, issues: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) }
    },
  }
}

export function definePlugin(def: PluginDefinition): CompiledPlugin {
  const names = new Set<string>()
  for (const tool of def.tools) {
    if (names.has(tool.name)) {
      throw new PluginDefinitionError(`duplicate tool name: ${tool.name}`)
    }
    names.add(tool.name)
  }
  const jobNames = new Set<string>()
  for (const job of def.jobs ?? []) {
    if (jobNames.has(job.name)) {
      throw new PluginDefinitionError(`duplicate job name: ${job.name}`)
    }
    jobNames.add(job.name)
    if (job.intervalMs < 1000) {
      throw new PluginDefinitionError(`job ${job.name}: intervalMs must be >= 1000`)
    }
  }
  return { ...def, tools: def.tools.map(compileTool) }
}

export function validateAgainstManifest(def: PluginDefinition, manifest: PluginManifest): void {
  for (const tool of def.tools) {
    if (!tool.name.startsWith(manifest.toolPrefix)) {
      throw new PluginDefinitionError(`tool ${tool.name} missing prefix ${manifest.toolPrefix}`)
    }
  }
}

export function toolJsonSchema(tool: ToolDef): Record<string, unknown> {
  return z.toJSONSchema(z.object(tool.params)) as Record<string, unknown>
}

export function defineTool<S extends z.ZodRawShape>(tool: ToolDef<S>): ToolDef<S> {
  return tool
}
