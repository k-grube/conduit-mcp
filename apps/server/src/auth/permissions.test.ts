import { describe, expect, it } from 'vitest'
import type { Grant, Role } from '../storage/roles-store.js'
import { NO_PERMISSIONS, allowsTool, filterIntegrations, resolvePermissions } from './permissions.js'

function role(grants: Role['grants']): Role {
  return { id: 'r', name: 'r', grants, surfaces: ['mcp'], members: { users: [], groups: [] } }
}

const readTool = { name: 'halopsa_get_ticket', pluginId: 'halopsa', readOnly: true }
const writeTool = { name: 'halopsa_add_action', pluginId: 'halopsa', readOnly: false }
const otherTool = { name: 'qbo_get_invoice', pluginId: 'qbo', readOnly: true }

describe('resolvePermissions', () => {
  it('wildcard_all sets wildcard', () => {
    const p = resolvePermissions([role([{ kind: 'wildcard_all' }])])
    expect(p.wildcard).toBe(true)
  })

  it('widens modes across roles', () => {
    const p = resolvePermissions([
      role([{ kind: 'integration', integrationId: 'halopsa', mode: 'read' }]),
      role([{ kind: 'integration', integrationId: 'halopsa', mode: 'write' }]),
    ])
    expect(p.integrations.get('halopsa')).toBe('all')
  })

  it('collects tool grants', () => {
    const p = resolvePermissions([role([{ kind: 'tool', toolName: 'qbo_get_invoice' }])])
    expect(p.tools.has('qbo_get_invoice')).toBe(true)
  })
})

describe('allowsTool', () => {
  it('wildcard allows everything', () => {
    const p = resolvePermissions([role([{ kind: 'wildcard_all' }])])
    expect(allowsTool(p, writeTool)).toBe(true)
  })

  it('read mode allows only readOnly tools', () => {
    const p = resolvePermissions([role([{ kind: 'integration', integrationId: 'halopsa', mode: 'read' }])])
    expect(allowsTool(p, readTool)).toBe(true)
    expect(allowsTool(p, writeTool)).toBe(false)
    expect(allowsTool(p, otherTool)).toBe(false)
  })

  it('write mode allows only write tools', () => {
    const p = resolvePermissions([role([{ kind: 'integration', integrationId: 'halopsa', mode: 'write' }])])
    expect(allowsTool(p, readTool)).toBe(false)
    expect(allowsTool(p, writeTool)).toBe(true)
  })

  it('star integration grant covers any plugin', () => {
    const p = resolvePermissions([role([{ kind: 'integration', integrationId: '*', mode: 'read' }])])
    expect(allowsTool(p, readTool)).toBe(true)
    expect(allowsTool(p, otherTool)).toBe(true)
    expect(allowsTool(p, writeTool)).toBe(false)
  })

  it('specific grant beats star when wider', () => {
    const p = resolvePermissions([
      role([
        { kind: 'integration', integrationId: '*', mode: 'read' },
        { kind: 'integration', integrationId: 'halopsa', mode: 'all' },
      ]),
    ])
    expect(allowsTool(p, writeTool)).toBe(true)
  })

  it('tool grant allows exactly that tool', () => {
    const p = resolvePermissions([role([{ kind: 'tool', toolName: 'halopsa_add_action' }])])
    expect(allowsTool(p, writeTool)).toBe(true)
    expect(allowsTool(p, readTool)).toBe(false)
  })

  it('NO_PERMISSIONS denies everything', () => {
    expect(allowsTool(NO_PERMISSIONS, readTool)).toBe(false)
  })
})

describe('filterIntegrations', () => {
  const infos = [
    { id: 'halopsa', name: 'HaloPSA', toolCount: 2 },
    { id: 'qbo', name: 'QuickBooks', toolCount: 1 },
  ]

  it('wildcard keeps all', () => {
    const p = resolvePermissions([role([{ kind: 'wildcard_all' }])])
    expect(filterIntegrations(p, infos)).toEqual(infos)
  })

  it('mode grants reveal their integration only', () => {
    const p = resolvePermissions([role([{ kind: 'integration', integrationId: 'halopsa', mode: 'read' }])])
    expect(filterIntegrations(p, infos).map((i) => i.id)).toEqual(['halopsa'])
  })

  it('tool grants do not reveal integrations', () => {
    const p = resolvePermissions([role([{ kind: 'tool', toolName: 'qbo_get_invoice' }])])
    expect(filterIntegrations(p, infos)).toEqual([])
  })
})

describe('notes_write', () => {
  it('grant sets notesWrite', () => {
    expect(resolvePermissions([role([{ kind: 'notes_write' }])]).notesWrite).toBe(true)
  })

  it('wildcard implies notesWrite', () => {
    expect(resolvePermissions([role([{ kind: 'wildcard_all' }])]).notesWrite).toBe(true)
  })

  it('other grants do not set notesWrite', () => {
    expect(resolvePermissions([role([{ kind: 'tool', toolName: 't' }])]).notesWrite).toBe(false)
    expect(NO_PERMISSIONS.notesWrite).toBe(false)
  })

  it('unknown grant kind grants nothing (no fail-open)', () => {
    const unknown = { kind: 'future_thing' } as unknown as Grant
    const p = resolvePermissions([role([unknown])])
    expect(p.wildcard).toBe(false)
    expect(p.integrations.size).toBe(0)
    expect(p.tools.size).toBe(0)
    expect(p.notesWrite).toBe(false)
  })
})

describe('NO_PERMISSIONS immutability', () => {
  it('rejects collection mutation', () => {
    expect(() => NO_PERMISSIONS.tools.add('x')).toThrow(/immutable/)
    expect(() => NO_PERMISSIONS.integrations.set('*', 'all')).toThrow(/immutable/)
  })
})
