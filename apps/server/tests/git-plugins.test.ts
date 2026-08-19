import { cp, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import type { PluginContext } from '@conduit-mcp/plugin-sdk'
import { PluginRegistryStore } from '../src/storage/plugin-registry.js'
import { ToolCatalog } from '../src/catalog/catalog.js'
import { PluginLoader } from '../src/plugins/loader.js'
import { defaultExec, installProdDeps, resolveCommit } from '../src/plugins/git.js'

const fixtureDir = join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures', 'demo-plugin')

const stubCtx = {
  getSecret: async () => '',
  setSecret: async () => {},
  getConfig: async () => ({}),
  invokeTool: async () => undefined,
  logger: { info: () => {}, warn: () => {}, error: () => {} },
  store: { get: async () => undefined, set: async () => {}, delete: async () => {} },
} as PluginContext

let repoDir: string
let headSha: string

beforeAll(async () => {
  repoDir = await mkdtemp(join(tmpdir(), 'conduit-repo-'))
  await cp(fixtureDir, repoDir, { recursive: true })
  const git = (args: string[]) => defaultExec('git', ['-C', repoDir, ...args])
  await defaultExec('git', ['init', '-b', 'main', repoDir])
  await git(['config', 'user.email', 'test@test'])
  await git(['config', 'user.name', 'test'])
  await git(['add', '-A'])
  await git(['commit', '-m', 'init'])
  headSha = (await git(['rev-parse', 'HEAD'])).stdout.trim()
})

describe('git helpers', () => {
  it('resolveCommit resolves HEAD of a ref', async () => {
    expect(await resolveCommit(repoDir, 'main', defaultExec)).toBe(headSha)
    expect(await resolveCommit(repoDir, undefined, defaultExec)).toBe(headSha)
  })

  it('resolveCommit throws on unknown ref', async () => {
    await expect(resolveCommit(repoDir, 'nope', defaultExec)).rejects.toThrow(/no commit/)
  })

  it('installProdDeps skips when there are no dependencies', async () => {
    expect(await installProdDeps(repoDir, defaultExec)).toBe(false)
  })

  it('installProdDeps invokes pnpm when dependencies exist', async () => {
    const calls: string[][] = []
    let shellFlag: boolean | undefined
    const fake = async (cmd: string, args: string[], opts?: { cwd?: string; shell?: boolean }) => {
      calls.push([cmd, ...args])
      shellFlag = opts?.shell
      return { stdout: '' }
    }
    const dir = await mkdtemp(join(tmpdir(), 'conduit-deps-'))
    const { writeFile } = await import('node:fs/promises')
    await writeFile(join(dir, 'package.json'), JSON.stringify({ dependencies: { minisearch: '7.0.0' } }))
    expect(await installProdDeps(dir, fake)).toBe(true)
    expect(calls[0][0]).toBe('pnpm')
    expect(calls[0]).toContain('--ignore-scripts')
    expect(calls[0]).toContain('--prod')
    expect(shellFlag).toBe(process.platform === 'win32')
  })
})

describe('git plugin loading', () => {
  it('clones, pins the commit, and loads to active', async () => {
    const registry = new PluginRegistryStore('GitT1')
    const catalog = new ToolCatalog()
    const pluginsRoot = await mkdtemp(join(tmpdir(), 'conduit-g-'))
    const loader = new PluginLoader({ registry, catalog, pluginsRoot, createContext: () => stubCtx })
    const rec = {
      id: 'demo',
      source: 'git' as const,
      repoUrl: repoDir,
      ref: 'main',
      enabled: true,
      status: 'loading' as const,
    }
    await registry.upsert(rec)
    await loader.load(rec)
    const after = await registry.get('demo')
    expect(after?.status).toBe('active')
    expect(after?.commit).toBe(headSha)
    expect(catalog.get('demo_echo')).toBeDefined()
  })

  it('second load with pinned commit reuses the prepared dir (no re-clone)', async () => {
    const registry = new PluginRegistryStore('GitT2')
    const catalog = new ToolCatalog()
    const pluginsRoot = await mkdtemp(join(tmpdir(), 'conduit-g2-'))
    const loader = new PluginLoader({ registry, catalog, pluginsRoot, createContext: () => stubCtx })
    const rec = {
      id: 'demo',
      source: 'git' as const,
      repoUrl: repoDir,
      ref: 'main',
      commit: headSha,
      enabled: true,
      status: 'loading' as const,
    }
    await registry.upsert(rec)
    await loader.load(rec)
    expect((await registry.get('demo'))?.status).toBe('active')
    // marker exists, second load must succeed without contacting the repo
    const calls: string[][] = []
    const spyExec = async (cmd: string, args: string[], opts?: { cwd?: string }) => {
      calls.push([cmd, ...args])
      return defaultExec(cmd, args, opts)
    }
    const loader2 = new PluginLoader({ registry, catalog, pluginsRoot, createContext: () => stubCtx, exec: spyExec })
    await loader2.load(rec)
    expect((await registry.get('demo'))?.status).toBe('active')
    expect(calls.filter((c) => c[0] === 'git' && c.includes('clone'))).toEqual([])
  })
})

describe('git plugin input fences', () => {
  // proves the rejection happens before exec is ever reached, not that a fake exec happened to throw
  async function loadRejected(table: string, rec: Record<string, unknown>) {
    const calls: string[][] = []
    const exec = async (cmd: string, args: string[]) => {
      calls.push([cmd, ...args])
      throw new Error('exec should not have been called')
    }
    const registry = new PluginRegistryStore(table)
    const catalog = new ToolCatalog()
    const pluginsRoot = await mkdtemp(join(tmpdir(), 'conduit-gf-'))
    const loader = new PluginLoader({ registry, catalog, pluginsRoot, createContext: () => stubCtx, exec })
    await registry.upsert(rec as never)
    await loader.load(rec as never)
    return { after: await registry.get(rec.id as string), calls }
  }

  it('rejects a plugin id outside the kebab-case charset', async () => {
    const { after, calls } = await loadRejected('GitF1', {
      id: 'Not_Valid',
      source: 'git',
      repoUrl: repoDir,
      ref: 'main',
      enabled: true,
      status: 'loading',
    })
    expect(after?.status).toBe('quarantined')
    expect(after?.lastError).toMatch(/^clone: plugin id/)
    expect(calls).toEqual([])
  })

  it('rejects a repoUrl starting with -', async () => {
    const { after, calls } = await loadRejected('GitF2', {
      id: 'demo',
      source: 'git',
      repoUrl: '--upload-pack=evil',
      ref: 'main',
      enabled: true,
      status: 'loading',
    })
    expect(after?.status).toBe('quarantined')
    expect(after?.lastError).toMatch(/^clone: repoUrl/)
    expect(calls).toEqual([])
  })

  it('rejects a repoUrl with a disallowed scheme', async () => {
    const { after, calls } = await loadRejected('GitF3', {
      id: 'demo',
      source: 'git',
      repoUrl: 'file:///etc/passwd',
      ref: 'main',
      enabled: true,
      status: 'loading',
    })
    expect(after?.status).toBe('quarantined')
    expect(after?.lastError).toMatch(/^clone: repoUrl/)
    expect(calls).toEqual([])
  })

  it('rejects a ref starting with -', async () => {
    const { after, calls } = await loadRejected('GitF4', {
      id: 'demo',
      source: 'git',
      repoUrl: repoDir,
      ref: '--upload-pack=evil',
      enabled: true,
      status: 'loading',
    })
    expect(after?.status).toBe('quarantined')
    expect(after?.lastError).toMatch(/^clone: ref/)
    expect(calls).toEqual([])
  })

  it('rejects a pinned commit that is not a 40-char sha', async () => {
    const { after, calls } = await loadRejected('GitF5', {
      id: 'demo',
      source: 'git',
      repoUrl: repoDir,
      ref: 'main',
      commit: 'not-a-sha',
      enabled: true,
      status: 'loading',
    })
    expect(after?.status).toBe('quarantined')
    expect(after?.lastError).toMatch(/^clone: .*commit/)
    expect(calls).toEqual([])
  })
})
