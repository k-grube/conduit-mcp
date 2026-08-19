import { describe, expect, it } from 'vitest'
import { parseManifest, ManifestError } from './manifest.js'

const valid = {
  id: 'halopsa',
  name: 'HaloPSA',
  toolPrefix: 'halopsa_',
  entry: 'src/index.ts',
  sdkVersion: '^0.1',
  secrets: ['HALOPSA_CLIENT_ID'],
}

describe('parseManifest', () => {
  it('accepts a minimal manifest and fills ui defaults', () => {
    const m = parseManifest(valid)
    expect(m.id).toBe('halopsa')
    expect(m.ui).toEqual({ settings: [], actions: [], statusCheck: false })
  })

  it('rejects bad ids', () => {
    expect(() => parseManifest({ ...valid, id: 'Halo PSA' })).toThrow(ManifestError)
  })

  it('rejects toolPrefix without trailing underscore', () => {
    expect(() => parseManifest({ ...valid, toolPrefix: 'halopsa' })).toThrow(ManifestError)
  })

  it('rejects secrets not in SCREAMING_SNAKE', () => {
    expect(() => parseManifest({ ...valid, secrets: ['lower-case'] })).toThrow(ManifestError)
  })

  it('collects issues with paths', () => {
    try {
      parseManifest({ id: 'x!', name: '', toolPrefix: 'x', entry: '', sdkVersion: '' })
      expect.unreachable()
    } catch (e) {
      expect((e as ManifestError).issues.length).toBeGreaterThan(2)
    }
  })

  it('rejects unrecognized top-level keys', () => {
    try {
      parseManifest({ ...valid, toolprefix: 'x_' })
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(ManifestError)
      expect((e as ManifestError).message).toMatch(/toolprefix/)
    }
  })

  it('parses ui settings fields and actions', () => {
    const m = parseManifest({
      ...valid,
      ui: {
        settings: [{ key: 'baseUrl', label: 'Base URL', type: 'text', required: true }],
        actions: [{ id: 'connect', label: 'Connect', route: '/oauth/start', method: 'GET' }],
        statusCheck: true,
      },
    })
    expect(m.ui.settings[0].type).toBe('text')
    expect(m.ui.actions[0].route).toBe('/oauth/start')
  })

  it('accepts ui setupHelp markdown', () => {
    const m = parseManifest({
      ...valid,
      ui: { setupHelp: '1. Create an API application\n2. Grant `read:tickets`' },
    })
    expect(m.ui.setupHelp).toBe('1. Create an API application\n2. Grant `read:tickets`')
  })

  it('leaves setupHelp undefined when not declared', () => {
    const m = parseManifest(valid)
    expect(m.ui.setupHelp).toBeUndefined()
  })

  it('defaults publicRoutes to an empty array', () => {
    const m = parseManifest(valid)
    expect(m.publicRoutes).toEqual([])
  })

  it('accepts declared publicRoutes', () => {
    const m = parseManifest({ ...valid, publicRoutes: ['/oauth/callback'] })
    expect(m.publicRoutes).toEqual(['/oauth/callback'])
  })

  it('rejects a publicRoutes entry not starting with /', () => {
    expect(() => parseManifest({ ...valid, publicRoutes: ['oauth/callback'] })).toThrow(ManifestError)
  })

  it('rejects a secret settings field whose key is not declared in secrets', () => {
    try {
      parseManifest({
        ...valid,
        ui: { settings: [{ key: 'MISSING_TOKEN', label: 'Token', type: 'secret' }] },
      })
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(ManifestError)
      expect((e as ManifestError).message).toMatch(/MISSING_TOKEN/)
    }
  })

  it('accepts a tags settings field', () => {
    const m = parseManifest({
      ...valid,
      ui: { settings: [{ key: 'serviceTeams', label: 'Service teams', type: 'tags' }] },
    })
    expect(m.ui.settings[0].type).toBe('tags')
  })

  it('accepts a secret settings field whose key matches a declared secret', () => {
    const m = parseManifest({
      ...valid,
      ui: { settings: [{ key: 'HALOPSA_CLIENT_ID', label: 'Client id', type: 'secret' }] },
    })
    expect(m.ui.settings[0].key).toBe('HALOPSA_CLIENT_ID')
  })
})
