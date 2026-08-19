import type { IntegrationInfo } from '../catalog/catalog.js'
import type { Role } from '../storage/roles-store.js'

export interface Permissions {
  wildcard: boolean
  integrations: Map<string, 'read' | 'write' | 'all'>
  tools: Set<string>
  notesWrite: boolean
}

class ImmutableMap<K, V> extends Map<K, V> {
  override set(): this {
    throw new Error('NO_PERMISSIONS is immutable')
  }

  override delete(): boolean {
    throw new Error('NO_PERMISSIONS is immutable')
  }

  override clear(): void {
    throw new Error('NO_PERMISSIONS is immutable')
  }
}

class ImmutableSet<T> extends Set<T> {
  override add(): this {
    throw new Error('NO_PERMISSIONS is immutable')
  }

  override delete(): boolean {
    throw new Error('NO_PERMISSIONS is immutable')
  }

  override clear(): void {
    throw new Error('NO_PERMISSIONS is immutable')
  }
}

export const NO_PERMISSIONS: Permissions = Object.freeze({
  wildcard: false,
  integrations: new ImmutableMap<string, 'read' | 'write' | 'all'>(),
  tools: new ImmutableSet<string>(),
  notesWrite: false,
})

function widen(a: 'read' | 'write' | 'all' | undefined, b: 'read' | 'write' | 'all'): 'read' | 'write' | 'all' {
  if (!a) {
    return b
  }
  if (a === b) {
    return a
  }
  return 'all'
}

export function resolvePermissions(roles: Role[]): Permissions {
  const p: Permissions = { wildcard: false, integrations: new Map(), tools: new Set(), notesWrite: false }
  for (const role of roles) {
    for (const grant of role.grants) {
      if (grant.kind === 'wildcard_all') {
        p.wildcard = true
        p.notesWrite = true
      } else if (grant.kind === 'integration') {
        p.integrations.set(grant.integrationId, widen(p.integrations.get(grant.integrationId), grant.mode))
      } else if (grant.kind === 'tool') {
        p.tools.add(grant.toolName)
      } else if (grant.kind === 'notes_write') {
        p.notesWrite = true
      }
    }
  }
  return p
}

export function modeAllows(mode: 'read' | 'write' | 'all' | undefined, readOnly: boolean): boolean {
  if (!mode) {
    return false
  }
  if (mode === 'all') {
    return true
  }
  return mode === 'read' ? readOnly : !readOnly
}

export function allowsTool(p: Permissions, entry: { name: string; pluginId: string; readOnly: boolean }): boolean {
  if (p.wildcard || p.tools.has(entry.name)) {
    return true
  }
  return (
    modeAllows(p.integrations.get(entry.pluginId), entry.readOnly) ||
    modeAllows(p.integrations.get('*'), entry.readOnly)
  )
}

export function filterIntegrations(p: Permissions, infos: IntegrationInfo[]): IntegrationInfo[] {
  if (p.wildcard || p.integrations.has('*')) {
    return infos
  }
  return infos.filter((i) => p.integrations.has(i.id))
}
