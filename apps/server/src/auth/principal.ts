import type { Role, RolesStore } from '../storage/roles-store.js'
import { resolvePermissions, type Permissions } from './permissions.js'

export type Principal =
  | { kind: 'apikey'; id: string; name: string; roleIds: string[] }
  | { kind: 'user'; id: string; oid: string; groups: string[]; name?: string }

export function serializePrincipal(p: Principal): string {
  return JSON.stringify(p)
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string')
}

export function parsePrincipal(s: string): Principal | undefined {
  try {
    const p = JSON.parse(s) as Record<string, unknown>
    if (!p || typeof p !== 'object' || typeof p.id !== 'string') {
      return undefined
    }
    if (p.kind === 'apikey' && typeof p.name === 'string' && isStringArray(p.roleIds)) {
      return { kind: 'apikey', id: p.id, name: p.name, roleIds: p.roleIds }
    }
    if (p.kind === 'user' && typeof p.oid === 'string' && isStringArray(p.groups)) {
      return {
        kind: 'user',
        id: p.id,
        oid: p.oid,
        groups: p.groups,
        name: typeof p.name === 'string' ? p.name : undefined,
      }
    }
    return undefined
  } catch {
    return undefined
  }
}

export async function rolesForPrincipal(
  p: Principal,
  store: RolesStore,
  surface: 'mcp' | 'portal' = 'mcp',
): Promise<Role[]> {
  const all = (await store.list()).filter((r) => r.surfaces.includes(surface))
  if (p.kind === 'apikey') {
    const wanted = new Set(p.roleIds)
    return all.filter((r) => wanted.has(r.id))
  }
  const groups = new Set(p.groups)
  return all.filter((r) => r.members.users.includes(p.oid) || r.members.groups.some((g) => groups.has(g)))
}

export async function permissionsForPrincipal(p: Principal, store: RolesStore): Promise<Permissions> {
  return resolvePermissions(await rolesForPrincipal(p, store))
}
