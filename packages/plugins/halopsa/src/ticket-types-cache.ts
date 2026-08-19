import type { PluginContext } from '@conduit-mcp/plugin-sdk'
import { getClient } from './client.js'

export interface TicketTypeRecord {
  id: number
  name: string
  use?: string
  project_type?: number
  visible?: boolean
}

export interface ClassifiedTypes {
  all: TicketTypeRecord[]
  masterIds: number[] // use:'projects' && project_type === 1
  taskIds: number[] // use:'projects' && project_type === 0
  opportunityIds: number[] // use:'opps'
}

// process-lifetime memoized, no ttl; resettable for tests
let cached: ClassifiedTypes | undefined

export function classifyTicketTypes(types: TicketTypeRecord[]): ClassifiedTypes {
  const masterIds: number[] = []
  const taskIds: number[] = []
  const opportunityIds: number[] = []
  for (const t of types) {
    const id = Number(t.id)
    if (!Number.isFinite(id)) {
      continue
    }
    const use = String(t.use ?? '').toLowerCase()
    const pt = Number(t.project_type ?? 0)
    if (use === 'projects' && pt === 1) {
      masterIds.push(id)
    } else if (use === 'projects' && pt === 0) {
      taskIds.push(id)
    } else if (use === 'opps') {
      opportunityIds.push(id)
    }
  }
  return { all: types, masterIds, taskIds, opportunityIds }
}

export async function getClassifiedTypes(ctx: PluginContext): Promise<ClassifiedTypes> {
  if (cached) {
    return cached
  }
  const client = await getClient(ctx)
  const raw = await client.getTicketTypes()
  const list = (Array.isArray(raw) ? raw : ((raw as Record<string, unknown>)?.types ?? [])) as TicketTypeRecord[]
  cached = classifyTicketTypes(list)
  return cached
}

export function resetTicketTypeCache(): void {
  cached = undefined
}

export type TicketTypeCategory = 'master' | 'task' | 'opportunity' | 'name'

export interface ResolvedTicketType {
  category: TicketTypeCategory
  ids: number[]
}

// resolve a user-supplied ticket_type keyword to an id bucket or the closest name match.
// returns null if nothing matches (caller decides whether to surface an error).
export function resolveTicketTypeKeyword(keyword: string, classified: ClassifiedTypes): ResolvedTicketType | null {
  const normalized = keyword.trim().toLowerCase()
  if (!normalized) {
    return null
  }
  // order matters: 'project task' must match before bare 'project'
  if (/\b(project\s*(task|phase)|phase|task)\b/.test(normalized)) {
    return { category: 'task', ids: classified.taskIds }
  }
  if (/\b(project|master)\b/.test(normalized)) {
    return { category: 'master', ids: classified.masterIds }
  }
  if (/opportunit/.test(normalized)) {
    return { category: 'opportunity', ids: classified.opportunityIds }
  }
  // fall back to exact-or-substring match against type names
  const match = classified.all.find((t) => {
    const name = String(t.name ?? '').toLowerCase()
    return name === normalized || name.includes(normalized)
  })
  if (match) {
    return { category: 'name', ids: [Number(match.id)] }
  }
  return null
}
