import { access, mkdir, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { Router } from 'express'
import {
  validateAgainstManifest,
  type CompiledPlugin,
  type PluginContext,
  type PluginManifest,
} from '@conduit-mcp/plugin-sdk'
import type { PluginHealth, PluginRecord, PluginRegistryStore } from '../storage/plugin-registry.js'
import type { ToolCatalog } from '../catalog/catalog.js'
import type { JobScheduler } from '../jobs/scheduler.js'
import { logEvent } from '../logger.js'
import { withLock } from '../storage/lock.js'
import { bundlePlugin } from './bundler.js'
import { cloneAtCommit, defaultExec, installProdDeps, resolveCommit, type ExecFn } from './git.js'
import { importPluginBundle, readManifest } from './importer.js'
import type { PluginRoutesRegistry } from './routes-registry.js'

export type LoadStage = 'manifest' | 'bundle' | 'import' | 'validate' | 'register' | 'clone' | 'install'

const PLUGIN_ID_RE = /^[a-z][a-z0-9-]*$/
const COMMIT_RE = /^[0-9a-f]{40}$/
// git treats a leading '-' as a flag: block argument injection via repoUrl/ref
// only https://, ssh://, git@ remotes or a local absolute path are trusted
const REMOTE_SCHEME_RE = /^(https:\/\/|ssh:\/\/|git@)/

export class PluginLoadError extends Error {
  stage: LoadStage
  constructor(stage: LoadStage, message: string) {
    super(message)
    this.name = 'PluginLoadError'
    this.stage = stage
  }
}

export interface LoaderDeps {
  registry: PluginRegistryStore
  catalog: ToolCatalog
  pluginsRoot: string
  createContext(manifest: PluginManifest): PluginContext
  exec?: ExecFn
  scheduler?: JobScheduler
  routes?: PluginRoutesRegistry
}

async function stage<T>(name: LoadStage, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof PluginLoadError) {
      throw err
    }
    throw new PluginLoadError(name, (err as Error).message)
  }
}

export class PluginLoader {
  protected deps: LoaderDeps

  constructor(deps: LoaderDeps) {
    this.deps = deps
  }

  async loadFromDir(rec: PluginRecord, dir: string): Promise<{ plugin: CompiledPlugin; ctx: PluginContext }> {
    const manifest = await stage('manifest', () => readManifest(dir))
    if (manifest.id !== rec.id) {
      throw new PluginLoadError('manifest', `manifest id ${manifest.id} does not match registry id ${rec.id}`)
    }
    const outFile = join(this.deps.pluginsRoot, '.build', `${rec.id}.mjs`)
    await mkdir(join(this.deps.pluginsRoot, '.build'), { recursive: true })
    await stage('bundle', () => bundlePlugin({ srcDir: dir, entry: manifest.entry, outFile }))
    const plugin = await stage('import', () => importPluginBundle(outFile))
    await stage('validate', async () => validateAgainstManifest(plugin, manifest))
    const ctx = this.deps.createContext(manifest)
    await stage('register', async () => this.deps.catalog.registerPlugin(manifest, plugin, ctx))
    return { plugin, ctx }
  }

  protected async resolveDir(rec: PluginRecord): Promise<string> {
    if (rec.source === 'local') {
      if (!rec.localPath) {
        throw new PluginLoadError('manifest', 'local plugin record has no localPath')
      }
      return isAbsolute(rec.localPath) ? rec.localPath : resolve(rec.localPath)
    }
    return this.prepareGitDir(rec)
  }

  private async prepareGitDir(rec: PluginRecord): Promise<string> {
    if (!rec.repoUrl) {
      throw new PluginLoadError('clone', 'git plugin record has no repoUrl')
    }
    if (!PLUGIN_ID_RE.test(rec.id)) {
      throw new PluginLoadError('clone', `plugin id ${rec.id} is not a valid identifier`)
    }
    if (rec.repoUrl.startsWith('-')) {
      throw new PluginLoadError('clone', `repoUrl must not start with '-': ${rec.repoUrl}`)
    }
    if (!REMOTE_SCHEME_RE.test(rec.repoUrl) && !isAbsolute(rec.repoUrl)) {
      throw new PluginLoadError(
        'clone',
        `repoUrl must be https://, ssh://, git@, or a local absolute path: ${rec.repoUrl}`,
      )
    }
    if (rec.ref?.startsWith('-')) {
      throw new PluginLoadError('clone', `ref must not start with '-': ${rec.ref}`)
    }
    const exec = this.deps.exec ?? defaultExec
    let commit = rec.commit
    if (!commit) {
      commit = await stage('clone', () => resolveCommit(rec.repoUrl!, rec.ref, exec))
      if (!COMMIT_RE.test(commit)) {
        throw new PluginLoadError('clone', `resolved commit is not a 40-char sha: ${commit}`)
      }
      await this.deps.registry.upsert({ ...rec, commit })
    } else if (!COMMIT_RE.test(commit)) {
      throw new PluginLoadError('clone', `pinned commit is not a 40-char sha: ${commit}`)
    }
    const dir = join(this.deps.pluginsRoot, rec.id, commit)
    const marker = join(dir, '.conduit-ready')
    if (await pathExists(marker)) {
      return dir
    }
    // no heartbeat renewal, ttl must exceed worst-case clone+install
    const prepared = await withLock(`plugin-build:${rec.id}`, 600_000, async () => {
      if (!(await pathExists(marker))) {
        await rm(dir, { recursive: true, force: true })
        await stage('clone', () => cloneAtCommit(rec.repoUrl!, commit, dir, exec))
        await stage('install', async () => {
          await installProdDeps(dir, exec)
        })
        await writeFile(marker, new Date().toISOString())
      }
      return dir
    })
    if (prepared === undefined) {
      throw new PluginLoadError('clone', 'build lock held')
    }
    return prepared
  }

  async load(rec: PluginRecord): Promise<void> {
    try {
      const dir = await this.resolveDir(rec)
      const { plugin, ctx } = await this.loadFromDir(rec, dir)
      // setStatus('active') clears lastError by design
      await this.setStatusSafe(rec.id, 'active_status_failed', 'active')
      this.deps.scheduler?.unregister(`plugin:${rec.id}:`)
      for (const job of plugin.jobs ?? []) {
        this.deps.scheduler?.register(`plugin:${rec.id}:${job.name}`, {
          intervalMs: job.intervalMs,
          run: () => job.run(ctx),
        })
      }
      this.deps.routes?.delete(rec.id)
      if (this.deps.routes && plugin.routes) {
        const pluginRouter = Router()
        plugin.routes(pluginRouter, ctx)
        this.deps.routes.set(rec.id, pluginRouter)
      }
      // awaited so the write lands inside the lifecycle lock, a failing check never quarantines
      await this.runHealthCheck(rec.id)
      logEvent('loader', 'loaded', { plugin: rec.id })
    } catch (err) {
      const stageName = err instanceof PluginLoadError ? err.stage : 'register'
      await this.unload(rec.id)
      await this.setStatusSafe(
        rec.id,
        'quarantine_status_failed',
        'quarantined',
        `${stageName}: ${(err as Error).message}`,
      )
      logEvent('loader', 'quarantined', { plugin: rec.id, stage: stageName, error: (err as Error).message })
    }
  }

  // a delete can win the lifecycle lock and remove the row between our read and this write, log instead of a 500
  private async setStatusSafe(
    id: string,
    failedEvent: string,
    status: PluginRecord['status'],
    lastError?: string,
  ): Promise<void> {
    try {
      await this.deps.registry.setStatus(id, status, lastError)
    } catch (err) {
      logEvent('loader', failedEvent, { plugin: id, error: (err as Error).message })
    }
  }

  // never throws: health is best-effort telemetry, a persist failure only logs
  async runHealthCheck(id: string): Promise<PluginHealth | undefined> {
    const result = await this.deps.catalog.health(id)
    if (!result) {
      return undefined
    }
    const health: PluginHealth = { ok: result.ok, detail: result.detail, checkedAt: new Date().toISOString() }
    try {
      await this.deps.registry.setHealth(id, health)
    } catch (err) {
      logEvent('loader', 'health_persist_failed', { plugin: id, error: (err as Error).message })
    }
    return health
  }

  async unload(id: string): Promise<void> {
    this.deps.catalog.removePlugin(id)
    this.deps.scheduler?.unregister(`plugin:${id}:`)
    this.deps.routes?.delete(id)
  }

  async loadAll(): Promise<void> {
    const records = await this.deps.registry.list()
    for (const rec of records) {
      if (!rec.enabled) {
        continue
      }
      await this.load(rec)
    }
  }
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}
