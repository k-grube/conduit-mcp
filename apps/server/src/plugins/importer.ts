import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseManifest, type CompiledPlugin, type PluginManifest } from '@conduit-mcp/plugin-sdk'

export async function readManifest(dir: string): Promise<PluginManifest> {
  const raw = await readFile(join(dir, 'conduit.plugin.json'), 'utf8')
  return parseManifest(JSON.parse(raw))
}

export async function importPluginBundle(bundlePath: string): Promise<CompiledPlugin> {
  const url = `${pathToFileURL(bundlePath).href}?v=${Date.now()}`
  const mod = (await import(url)) as { default?: CompiledPlugin }
  if (!mod.default || !Array.isArray(mod.default.tools)) {
    throw new Error(`plugin bundle ${bundlePath} has no plugin default export`)
  }
  for (const tool of mod.default.tools) {
    const t = tool as unknown as Record<string, unknown>
    if (
      typeof t.name !== 'string' ||
      typeof t.jsonSchema !== 'object' ||
      t.jsonSchema === null ||
      typeof t.validate !== 'function' ||
      typeof t.handler !== 'function'
    ) {
      throw new Error(`plugin bundle ${bundlePath} has an invalid compiled tool: ${JSON.stringify(tool)}`)
    }
  }
  return mod.default
}
