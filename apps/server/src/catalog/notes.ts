import { logEvent } from '../logger.js'
import type { ConfigStore } from '../storage/config-store.js'
import type { ToolCatalog } from './catalog.js'

export const TOOL_NOTE_MAX = 2000
export const INTEGRATION_NOTE_MAX = 4000

export interface NoteEntry {
  text: string
  updatedBy: string
  updatedAt: string
}

export interface NotesSnapshot {
  tools: Record<string, NoteEntry>
  integrations: Record<string, NoteEntry>
}

// domain rows keep null tombstones, deepMerge cannot delete keys
type NotesDomain = {
  tools?: Record<string, NoteEntry | null>
  integrations?: Record<string, NoteEntry | null>
}

export class UnknownNotesTargetError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnknownNotesTargetError'
  }
}

export class NoteTooLongError extends Error {
  constructor(max: number) {
    super(`note exceeds ${max} chars`)
    this.name = 'NoteTooLongError'
  }
}

function live(map: Record<string, NoteEntry | null> | undefined): Record<string, NoteEntry> {
  const out: Record<string, NoteEntry> = {}
  for (const [k, v] of Object.entries(map ?? {})) {
    if (v && v.text) {
      out[k] = v
    }
  }
  return out
}

export async function loadNotesSnapshot(config: ConfigStore): Promise<NotesSnapshot> {
  const d = await config.getDomain<NotesDomain>('toolNotes')
  return { tools: live(d.tools), integrations: live(d.integrations) }
}

export class NotesService {
  private deps: { config: ConfigStore; catalog: ToolCatalog }

  constructor(deps: { config: ConfigStore; catalog: ToolCatalog }) {
    this.deps = deps
  }

  private async apply(): Promise<void> {
    const snap = await loadNotesSnapshot(this.deps.config)
    this.deps.catalog.setNotes({
      tools: Object.fromEntries(Object.entries(snap.tools).map(([k, v]) => [k, v.text])),
      integrations: Object.fromEntries(Object.entries(snap.integrations).map(([k, v]) => [k, v.text])),
    })
  }

  async start(): Promise<() => void> {
    await this.apply()
    // in-process listener, cross-replica drift accepted (single-instance deploy)
    return this.deps.config.onChange((domain) => {
      if (domain !== 'toolNotes') {
        return
      }
      void this.apply().catch((err: Error) => logEvent('notes', 'reload_failed', { error: err.message }))
    })
  }

  async update(input: { integration: string; tool?: string; notes: string | null; principal: string }): Promise<void> {
    const { integration, tool } = input
    // normalize empty/whitespace-only notes to null (clear operation)
    const notes = input.notes !== null ? input.notes.trim() || null : null
    if (!this.deps.catalog.integrations().some((i) => i.id === integration)) {
      throw new UnknownNotesTargetError(`unknown integration: ${integration}`)
    }
    if (tool !== undefined) {
      const entry = this.deps.catalog.get(tool)
      if (!entry || entry.pluginId !== integration) {
        throw new UnknownNotesTargetError(`unknown tool for ${integration}: ${tool}`)
      }
    }
    const max = tool !== undefined ? TOOL_NOTE_MAX : INTEGRATION_NOTE_MAX
    if (notes !== null && notes.length > max) {
      throw new NoteTooLongError(max)
    }
    const value: NoteEntry | null =
      notes === null ? null : { text: notes, updatedBy: input.principal, updatedAt: new Date().toISOString() }
    const patch = tool !== undefined ? { tools: { [tool]: value } } : { integrations: { [integration]: value } }
    await this.deps.config.updateDomain('toolNotes', patch)
    await this.apply()
    logEvent('notes', 'updated', {
      integration,
      ...(tool !== undefined ? { tool } : {}),
      principal: input.principal,
      chars: notes?.length ?? 0,
    })
  }
}
