import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import type { PluginRegistryStore, PluginRecord } from '../storage/plugin-registry.js'
import type { PluginLoader } from '../plugins/loader.js'
import type { ToolCatalog } from '../catalog/catalog.js'
import { withLock } from '../storage/lock.js'
import type { ConfigStore } from '../storage/config-store.js'
import type { SecretProvider } from '../secrets/provider.js'
import { computeConfigured, deriveDisplayStatus } from '../plugins/status.js'

// matches the git build lock ttl, no heartbeat renewal so it must exceed worst-case load
const LIFECYCLE_LOCK_TTL_MS = 600_000

function lifecycleLock<T>(id: string, fn: () => Promise<T>): Promise<T | undefined> {
  return withLock(`plugin-lifecycle:${id}`, LIFECYCLE_LOCK_TTL_MS, fn)
}

// fn's authoritative re-read decides this: missing/conflict beat whatever the pre-lock fast-path saw
type LockOutcome = { kind: 'missing' } | { kind: 'conflict' } | { kind: 'disabled' } | { kind: 'ok'; body: unknown }

// undefined from withLock means lock contention, not a genuine result, so it maps to 409 separately from LockOutcome
function respondLockOutcome(res: Response, result: LockOutcome | undefined, okStatus: number): void {
  if (result === undefined) {
    res.status(409).json({ error: 'lifecycle operation in progress' })
    return
  }
  if (result.kind === 'missing') {
    res.status(404).json({ error: 'unknown plugin' })
    return
  }
  if (result.kind === 'conflict') {
    res.status(409).json({ error: 'plugin exists' })
    return
  }
  if (result.kind === 'disabled') {
    res.status(409).json({ error: 'plugin disabled' })
    return
  }
  if (okStatus === 204) {
    res.status(204).end()
    return
  }
  res.status(okStatus).json(result.body)
}

const RegisterSchema = z
  .strictObject({
    id: z
      .string()
      .regex(/^[a-z][a-z0-9-]*$/)
      .max(40),
    source: z.enum(['git', 'local']),
    repoUrl: z.string().min(1).optional(),
    ref: z.string().min(1).optional(),
    localPath: z.string().min(1).optional(),
  })
  .refine(
    (v) => (v.source === 'git' ? Boolean(v.repoUrl) : Boolean(v.localPath)),
    'git requires repoUrl, local requires localPath',
  )

export function createPluginsRouter(deps: {
  registry: PluginRegistryStore
  loader: PluginLoader
  catalog: ToolCatalog
  config: ConfigStore
  secrets: SecretProvider
}): Router {
  const router = Router()

  async function derived(rec: PluginRecord) {
    const configured = await computeConfigured(deps.catalog.getManifest(rec.id), deps)
    return {
      ...rec,
      toolCount: deps.catalog.list(rec.id).length,
      configured,
      displayStatus: deriveDisplayStatus(rec, configured),
    }
  }

  router.get('/', async (_req: Request, res: Response) => {
    const records = await deps.registry.list()
    res.json(await Promise.all(records.map(derived)))
  })

  router.post('/', async (req: Request, res: Response) => {
    const parsed = RegisterSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0].message })
      return
    }
    // fast-path only, the authoritative check happens inside the lock below
    if (await deps.registry.get(parsed.data.id)) {
      res.status(409).json({ error: 'plugin exists' })
      return
    }
    const result = await lifecycleLock<LockOutcome>(parsed.data.id, async () => {
      if (await deps.registry.get(parsed.data.id)) {
        return { kind: 'conflict' }
      }
      const rec: PluginRecord = { ...parsed.data, enabled: true, status: 'loading' }
      await deps.registry.upsert(rec)
      await deps.loader.load(rec)
      const after = await deps.registry.get(rec.id)
      return { kind: 'ok', body: after ? await derived(after) : null }
    })
    respondLockOutcome(res, result, 201)
  })

  router.get('/:id', async (req: Request<{ id: string }>, res: Response) => {
    const record = await deps.registry.get(req.params.id)
    if (!record) {
      res.status(404).json({ error: 'unknown plugin' })
      return
    }
    const item = await derived(record)
    res.json({
      record,
      manifest: deps.catalog.getManifest(req.params.id),
      configured: item.configured,
      displayStatus: item.displayStatus,
    })
  })

  router.get('/:id/health', async (req: Request<{ id: string }>, res: Response) => {
    const record = await deps.registry.get(req.params.id)
    if (!record) {
      res.status(404).json({ error: 'unknown plugin' })
      return
    }
    const health = await deps.loader.runHealthCheck(req.params.id)
    res.json(health ?? { ok: deps.catalog.getManifest(req.params.id) !== undefined, detail: 'no health check' })
  })

  // per-replica: other replicas pick up disable/delete at restart, same limitation as auth hot-reload
  router.post('/:id/reload', async (req: Request<{ id: string }>, res: Response) => {
    // fast-path only, the authoritative check happens inside the lock below
    if (!(await deps.registry.get(req.params.id))) {
      res.status(404).json({ error: 'unknown plugin' })
      return
    }
    const result = await lifecycleLock<LockOutcome>(req.params.id, async () => {
      const record = await deps.registry.get(req.params.id)
      if (!record) {
        return { kind: 'missing' }
      }
      if (!record.enabled) {
        return { kind: 'disabled' }
      }
      const rec = record.source === 'git' ? { ...record, commit: undefined } : record
      await deps.registry.upsert(rec)
      await deps.loader.load(rec)
      const after = await deps.registry.get(req.params.id)
      return { kind: 'ok', body: after ? await derived(after) : null }
    })
    respondLockOutcome(res, result, 200)
  })

  router.post('/:id/enable', async (req: Request<{ id: string }>, res: Response) => {
    // fast-path only, the authoritative check happens inside the lock below
    if (!(await deps.registry.get(req.params.id))) {
      res.status(404).json({ error: 'unknown plugin' })
      return
    }
    const result = await lifecycleLock<LockOutcome>(req.params.id, async () => {
      const record = await deps.registry.get(req.params.id)
      if (!record) {
        return { kind: 'missing' }
      }
      const rec = { ...record, enabled: true }
      await deps.registry.upsert(rec)
      await deps.loader.load(rec)
      const after = await deps.registry.get(req.params.id)
      return { kind: 'ok', body: after ? await derived(after) : null }
    })
    respondLockOutcome(res, result, 200)
  })

  router.post('/:id/disable', async (req: Request<{ id: string }>, res: Response) => {
    // fast-path only, the authoritative check happens inside the lock below
    if (!(await deps.registry.get(req.params.id))) {
      res.status(404).json({ error: 'unknown plugin' })
      return
    }
    const result = await lifecycleLock<LockOutcome>(req.params.id, async () => {
      const record = await deps.registry.get(req.params.id)
      if (!record) {
        return { kind: 'missing' }
      }
      await deps.registry.upsert({ ...record, enabled: false })
      await deps.loader.unload(req.params.id)
      const after = await deps.registry.get(req.params.id)
      return { kind: 'ok', body: after ? await derived(after) : null }
    })
    respondLockOutcome(res, result, 200)
  })

  router.delete('/:id', async (req: Request<{ id: string }>, res: Response) => {
    // fast-path only, the authoritative check happens inside the lock below
    if (!(await deps.registry.get(req.params.id))) {
      res.status(404).json({ error: 'unknown plugin' })
      return
    }
    const result = await lifecycleLock<LockOutcome>(req.params.id, async () => {
      const record = await deps.registry.get(req.params.id)
      if (!record) {
        return { kind: 'missing' }
      }
      await deps.loader.unload(req.params.id)
      await deps.registry.remove(req.params.id)
      return { kind: 'ok', body: null }
    })
    respondLockOutcome(res, result, 204)
  })

  return router
}
