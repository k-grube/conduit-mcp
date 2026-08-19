import { describe, expect, it } from 'vitest'
import { definePlugin, defineTool, parseManifest, z, type PluginContext } from '@conduit-mcp/plugin-sdk'
import { ConfigStore } from '../src/storage/config-store.js'
import { ToolCatalog } from '../src/catalog/catalog.js'
import {
  INTEGRATION_NOTE_MAX,
  loadNotesSnapshot,
  NoteTooLongError,
  NotesService,
  TOOL_NOTE_MAX,
  UnknownNotesTargetError,
} from '../src/catalog/notes.js'

const stubCtx = {
  getSecret: async () => '',
  setSecret: async () => {},
  getConfig: async () => ({}),
  invokeTool: async () => undefined,
  logger: { info: () => {}, warn: () => {}, error: () => {} },
  store: { get: async () => undefined, set: async () => {}, delete: async () => {} },
} as PluginContext

function seededCatalog() {
  const cat = new ToolCatalog()
  cat.registerPlugin(
    parseManifest({ id: 'demo', name: 'Demo', toolPrefix: 'demo_', entry: 'e', sdkVersion: '^0.1' }),
    definePlugin({
      tools: [
        defineTool({
          name: 'demo_echo',
          description: 'echo text back',
          keywords: ['echo'],
          params: { text: z.string() },
          readOnly: true,
          handler: async (args) => args.text,
        }),
      ],
    }),
    stubCtx,
  )
  cat.registerPlugin(
    parseManifest({ id: 'other', name: 'Other', toolPrefix: 'other_', entry: 'e', sdkVersion: '^0.1' }),
    definePlugin({
      tools: [
        defineTool({
          name: 'other_tool',
          description: 'a tool in the other integration',
          keywords: [],
          params: {},
          readOnly: true,
          handler: async () => undefined,
        }),
      ],
    }),
    stubCtx,
  )
  return cat
}

describe('NotesService', () => {
  it('update writes a stamped entry and start() applies it to the catalog', async () => {
    const config = new ConfigStore({ tableName: 'NotesSvcA' })
    const catalog = seededCatalog()
    const svc = new NotesService({ config, catalog })
    await svc.start()
    await svc.update({ integration: 'demo', tool: 'demo_echo', notes: 'CFClientCode lore', principal: 'user:x' })
    expect(catalog.get('demo_echo')?.notes).toBe('CFClientCode lore')
    const snap = await loadNotesSnapshot(config)
    expect(snap.tools.demo_echo.text).toBe('CFClientCode lore')
    expect(snap.tools.demo_echo.updatedBy).toBe('user:x')
    expect(snap.tools.demo_echo.updatedAt).toMatch(/^\d{4}-/)
  })

  it('integration-level note lands in integrations map and catalog', async () => {
    const config = new ConfigStore({ tableName: 'NotesSvcB' })
    const catalog = seededCatalog()
    const svc = new NotesService({ config, catalog })
    await svc.start()
    await svc.update({ integration: 'demo', notes: 'halo lore', principal: 'user:x' })
    expect(catalog.integrationNotes('demo')).toBe('halo lore')
  })

  it('null clears via tombstone', async () => {
    const config = new ConfigStore({ tableName: 'NotesSvcC' })
    const catalog = seededCatalog()
    const svc = new NotesService({ config, catalog })
    await svc.start()
    await svc.update({ integration: 'demo', tool: 'demo_echo', notes: 'x', principal: 'user:x' })
    await svc.update({ integration: 'demo', tool: 'demo_echo', notes: null, principal: 'user:x' })
    expect(catalog.get('demo_echo')?.notes).toBeUndefined()
    expect((await loadNotesSnapshot(config)).tools.demo_echo).toBeUndefined()
  })

  it('rejects unknown targets and oversized notes', async () => {
    const config = new ConfigStore({ tableName: 'NotesSvcD' })
    const catalog = seededCatalog()
    const svc = new NotesService({ config, catalog })
    await expect(svc.update({ integration: 'nope', notes: 'x', principal: 'p' })).rejects.toBeInstanceOf(
      UnknownNotesTargetError,
    )
    await expect(
      svc.update({ integration: 'demo', tool: 'other_tool', notes: 'x', principal: 'p' }),
    ).rejects.toBeInstanceOf(UnknownNotesTargetError)
    await expect(
      svc.update({ integration: 'demo', tool: 'demo_echo', notes: 'x'.repeat(TOOL_NOTE_MAX + 1), principal: 'p' }),
    ).rejects.toBeInstanceOf(NoteTooLongError)
    await expect(
      svc.update({ integration: 'demo', notes: 'x'.repeat(INTEGRATION_NOTE_MAX + 1), principal: 'p' }),
    ).rejects.toBeInstanceOf(NoteTooLongError)
  })

  it('empty and whitespace-only notes normalize to clear', async () => {
    const config = new ConfigStore({ tableName: 'NotesSvcE' })
    const catalog = seededCatalog()
    const svc = new NotesService({ config, catalog })
    await svc.start()
    // tool-level: empty string clears
    await svc.update({ integration: 'demo', tool: 'demo_echo', notes: 'real note', principal: 'user:x' })
    expect(catalog.get('demo_echo')?.notes).toBe('real note')
    await svc.update({ integration: 'demo', tool: 'demo_echo', notes: '', principal: 'user:x' })
    expect(catalog.get('demo_echo')?.notes).toBeUndefined()
    expect((await loadNotesSnapshot(config)).tools.demo_echo).toBeUndefined()
    // tool-level: whitespace clears
    await svc.update({ integration: 'demo', tool: 'demo_echo', notes: 'another', principal: 'user:x' })
    await svc.update({ integration: 'demo', tool: 'demo_echo', notes: '   ', principal: 'user:x' })
    expect(catalog.get('demo_echo')?.notes).toBeUndefined()
    expect((await loadNotesSnapshot(config)).tools.demo_echo).toBeUndefined()
    // integration-level: empty string clears
    await svc.update({ integration: 'demo', notes: 'integration note', principal: 'user:x' })
    expect(catalog.integrationNotes('demo')).toBe('integration note')
    await svc.update({ integration: 'demo', notes: '', principal: 'user:x' })
    expect(catalog.integrationNotes('demo')).toBeUndefined()
    expect((await loadNotesSnapshot(config)).integrations.demo).toBeUndefined()
    // integration-level: whitespace clears
    await svc.update({ integration: 'demo', notes: 'another integration', principal: 'user:x' })
    await svc.update({ integration: 'demo', notes: '\t\n ', principal: 'user:x' })
    expect(catalog.integrationNotes('demo')).toBeUndefined()
    expect((await loadNotesSnapshot(config)).integrations.demo).toBeUndefined()
  })
})
