import { randomUUID } from 'node:crypto'
import { Router, type Request, type Response } from 'express'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import type { ToolCatalog } from '../catalog/catalog.js'
import type { ToolSearch } from '../catalog/search.js'
import type { NotesService } from '../catalog/notes.js'
import { logEvent } from '../logger.js'
import { getPrincipal } from '../auth/middleware.js'
import { parsePrincipal, permissionsForPrincipal, serializePrincipal, type Principal } from '../auth/principal.js'
import type { Permissions } from '../auth/permissions.js'
import type { RolesStore } from '../storage/roles-store.js'
import { createMcpServer, type UsageEvent } from './meta-tools.js'
import type { AdtEventStore } from './event-store.js'
import type { AdtSessionStore, SessionRecord } from './session-store.js'

export interface McpRouterDeps {
  catalog: ToolCatalog
  search: ToolSearch
  sessions: AdtSessionStore
  eventStore: AdtEventStore
  roles: RolesStore
  notes?: NotesService
  onUsage?: (e: UsageEvent) => void
  // evaluated per session at connect, feeds the initialize instructions field
  getInstructions?: () => string | undefined
  idleMs?: number
  sweepMs?: number
  maxSessionsPerPrincipal?: number
}

interface LiveSession {
  transport: StreamableHTTPServerTransport
  lastSeen: number
  principalId: string
}

// sdk 1.29.0 exposes no session-adoption api, reach into _webStandardTransport/_initialized (pinned, guarded below)
interface InnerTransport {
  sessionId?: string
  _initialized: boolean
}

function inner(transport: StreamableHTTPServerTransport): InnerTransport | undefined {
  const t = (transport as unknown as { _webStandardTransport?: InnerTransport })._webStandardTransport
  return t && typeof t === 'object' ? t : undefined
}

const SESSION_NOT_FOUND = { jsonrpc: '2.0', error: { code: -32001, message: 'session not found' }, id: null }

export function createMcpRouter(deps: McpRouterDeps): {
  router: Router
  close(): Promise<void>
  dropAllSessions(): Promise<void>
} {
  const idleMs = deps.idleMs ?? 1_800_000
  const live = new Map<string, LiveSession>()

  // forked per transport so the sdk's shared `_GET_stream` id partitions by session, not globally
  function newTransportShell(eventStore: AdtEventStore, principalJson: string): StreamableHTTPServerTransport {
    const principalId = parsePrincipal(principalJson)?.id ?? 'unknown'
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      eventStore,
      onsessioninitialized: (sid) => {
        eventStore.scope = sid
        live.set(sid, { transport, lastSeen: Date.now(), principalId })
        void deps.sessions.create(sid, principalJson)
        logEvent('mcp', 'session_start', { sid, principalId })
      },
      onsessionclosed: (sid) => {
        live.delete(sid)
        void deps.sessions.remove(sid)
        logEvent('mcp', 'session_end', { sid })
      },
    })
    return transport
  }

  function connectServer(
    transport: StreamableHTTPServerTransport,
    principalId: string,
    permissions: Permissions,
  ): void {
    const server = createMcpServer({
      catalog: deps.catalog,
      search: deps.search,
      notes: deps.notes,
      onUsage: deps.onUsage,
      principal: principalId,
      permissions,
      instructions: deps.getInstructions?.(),
    })
    void server.connect(transport)
  }

  async function buildTransport(principal: Principal): Promise<StreamableHTTPServerTransport> {
    const permissions = await permissionsForPrincipal(principal, deps.roles)
    const transport = newTransportShell(deps.eventStore.fork(), serializePrincipal(principal))
    connectServer(transport, principal.id, permissions)
    return transport
  }

  async function rehydrate(sid: string, rec: SessionRecord): Promise<StreamableHTTPServerTransport | undefined> {
    const principal = parsePrincipal(rec.principal)
    if (!principal) {
      void deps.sessions.remove(sid)
      return undefined
    }
    const permissions = await permissionsForPrincipal(principal, deps.roles)
    const transport = newTransportShell(deps.eventStore.fork(sid), rec.principal)
    const t = inner(transport)
    if (!t) {
      logEvent('mcp', 'rehydrate_failed', { sid })
      return undefined
    }
    t.sessionId = sid
    t._initialized = true
    live.set(sid, { transport, lastSeen: Date.now(), principalId: principal.id })
    connectServer(transport, principal.id, permissions)
    return transport
  }

  async function transportFor(sid: string): Promise<StreamableHTTPServerTransport | undefined> {
    const hit = live.get(sid)
    if (hit) {
      return hit.transport
    }
    // other-replica or restarted-process session: rehydrate from adt
    const rec = await deps.sessions.get(sid)
    if (!rec) {
      return undefined
    }
    if (rec.expiresAt < new Date().toISOString()) {
      void deps.sessions.remove(sid)
      return undefined
    }
    return rehydrate(sid, rec)
  }

  async function handle(req: Request, res: Response): Promise<void> {
    const principal = getPrincipal(res)
    const sid = req.headers['mcp-session-id'] as string | undefined
    if (sid) {
      const transport = await transportFor(sid)
      if (!transport) {
        res.status(404).json(SESSION_NOT_FOUND)
        return
      }
      const hit = live.get(sid)
      if (hit?.principalId !== principal.id) {
        res
          .status(403)
          .json({ jsonrpc: '2.0', error: { code: -32003, message: 'session principal mismatch' }, id: null })
        return
      }
      hit.lastSeen = Date.now()
      void deps.sessions.touch(sid)
      await transport.handleRequest(req, res, req.body)
      return
    }
    if (req.method === 'POST' && isInitializeRequest(req.body)) {
      const cap = deps.maxSessionsPerPrincipal ?? 20
      const held = [...live.values()].filter((s) => s.principalId === principal.id).length
      if (held >= cap) {
        res.status(429).json({ error: 'too many sessions' })
        return
      }
      const transport = await buildTransport(principal)
      await transport.handleRequest(req, res, req.body)
      return
    }
    res.status(400).json({ jsonrpc: '2.0', error: { code: -32000, message: 'missing session id' }, id: null })
  }

  const router = Router()
  router.post('/', handle)
  router.get('/', handle)
  router.delete('/', handle)

  const sweep = setInterval(() => {
    const cutoff = Date.now() - idleMs
    for (const [sid, s] of live) {
      if (s.lastSeen < cutoff) {
        live.delete(sid)
        void s.transport.close()
        void deps.sessions.remove(sid)
        logEvent('mcp', 'session_idle_evict', { sid })
      }
    }
  }, deps.sweepMs ?? 60_000)
  sweep.unref()

  return {
    router,
    close: async () => {
      clearInterval(sweep)
      await Promise.all([...live.values()].map((s) => s.transport.close()))
      live.clear()
    },
    dropAllSessions: async () => {
      await Promise.all(
        [...live.entries()].map(async ([sid, s]) => {
          await s.transport.close()
          await deps.sessions.remove(sid)
        }),
      )
      live.clear()
    },
  }
}
