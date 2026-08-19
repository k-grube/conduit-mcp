import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi, type Mock } from 'vitest'
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'
import { AdtSessionStore } from '../src/mcp/session-store.js'
import { AdtEventStore } from '../src/mcp/event-store.js'

// storeEvent's collision-retry test needs to force a rowkey collision on demand, real randomBytes stays the default impl
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>()
  return { ...actual, randomBytes: vi.fn(actual.randomBytes) }
})

const msg = (id: number): JSONRPCMessage => ({ jsonrpc: '2.0', method: 'notifications/message', params: { id } })
// rowkey ms-prefix ties break on a random hex suffix, force distinct prefixes for order-sensitive assertions
const tick = () => new Promise((r) => setTimeout(r, 2))

describe('AdtSessionStore', () => {
  it('create/get/touch/remove round-trip', async () => {
    const store = new AdtSessionStore('SessT1')
    await store.create('s1', 'anonymous')
    const rec = await store.get('s1')
    expect(rec?.principal).toBe('anonymous')
    await store.touch('s1')
    expect((await store.get('s1'))!.lastSeenAt >= rec!.lastSeenAt).toBe(true)
    await store.remove('s1')
    expect(await store.get('s1')).toBeUndefined()
  })

  it('touch on unknown session does not throw', async () => {
    const store = new AdtSessionStore('SessT2')
    await expect(store.touch('nope')).resolves.toBeUndefined()
  })

  it('create sets expiresAt ttlMs out, default 24h', async () => {
    const store = new AdtSessionStore('SessT3')
    const before = Date.now()
    await store.create('s2', 'anonymous')
    const expiresAt = new Date((await store.get('s2'))!.expiresAt).getTime()
    expect(expiresAt).toBeGreaterThan(before + 23 * 60 * 60 * 1000)
    expect(expiresAt).toBeLessThan(before + 25 * 60 * 60 * 1000)
  })

  it('honors a custom ttlMs', async () => {
    const store = new AdtSessionStore('SessT4', 1000)
    const before = Date.now()
    await store.create('s3', 'anonymous')
    const expiresAt = new Date((await store.get('s3'))!.expiresAt).getTime()
    expect(expiresAt - before).toBeLessThan(2000)
  })

  it('touch extends expiresAt', async () => {
    const store = new AdtSessionStore('SessT5', 1000)
    await store.create('s4', 'anonymous')
    const first = (await store.get('s4'))!.expiresAt
    await new Promise((r) => setTimeout(r, 20))
    await store.touch('s4')
    const second = (await store.get('s4'))!.expiresAt
    expect(second > first).toBe(true)
  })
})

describe('AdtEventStore', () => {
  it('stores events and replays only those after the given id', async () => {
    const store = new AdtEventStore('EvtT1')
    const e1 = await store.storeEvent('stream-a', msg(1))
    const e2 = await store.storeEvent('stream-a', msg(2))
    const e3 = await store.storeEvent('stream-a', msg(3))
    expect(e1 < e2 && e2 < e3).toBe(true)
    const sent: { id: string; message: JSONRPCMessage }[] = []
    const streamId = await store.replayEventsAfter(e1, {
      send: async (id, message) => {
        sent.push({ id, message })
      },
    })
    expect(streamId).toBe('stream-a')
    expect(sent.map((s) => s.id)).toEqual([e2, e3])
  })

  it('does not replay events from other streams', async () => {
    const store = new AdtEventStore('EvtT2')
    const e1 = await store.storeEvent('stream-a', msg(1))
    await store.storeEvent('stream-b', msg(9))
    const sent: string[] = []
    await store.replayEventsAfter(e1, {
      send: async (id) => {
        sent.push(id)
      },
    })
    expect(sent).toEqual([])
  })

  it('rejects malformed event ids', async () => {
    const store = new AdtEventStore('EvtT3')
    await expect(store.replayEventsAfter('garbage', { send: async () => {} })).rejects.toThrow(/invalid event id/)
  })

  it('rejects injection attempts in event ids', async () => {
    const store = new AdtEventStore('EvtT4')
    await expect(
      store.replayEventsAfter("evil' or PartitionKey ne ''|00000000000001-abcd", { send: async () => {} }),
    ).rejects.toThrow(/invalid event id/)
  })

  it('round-trips the sdk standalone stream id and a random session stream id under a scope', async () => {
    const store = new AdtEventStore('EvtT5')
    store.scope = 'sess-x'
    const g1 = await store.storeEvent('_GET_stream', msg(1))
    await tick()
    const g2 = await store.storeEvent('_GET_stream', msg(2))
    const sentG: string[] = []
    const gStreamId = await store.replayEventsAfter(g1, { send: async (id) => void sentG.push(id) })
    expect(gStreamId).toBe('_GET_stream')
    expect(sentG).toEqual([g2])

    const uuid = randomUUID()
    const u1 = await store.storeEvent(uuid, msg(3))
    await tick()
    const u2 = await store.storeEvent(uuid, msg(4))
    const sentU: string[] = []
    const uStreamId = await store.replayEventsAfter(u1, { send: async (id) => void sentU.push(id) })
    expect(uStreamId).toBe(uuid)
    expect(sentU).toEqual([u2])
  })

  it('isolates same-named streams (e.g. the shared _GET_stream) across scopes', async () => {
    const storeA = new AdtEventStore('EvtT6')
    storeA.scope = 'sess-a'
    const storeB = new AdtEventStore('EvtT6')
    storeB.scope = 'sess-b'
    const aFirst = await storeA.storeEvent('_GET_stream', msg(1))
    await tick()
    await storeB.storeEvent('_GET_stream', msg(2))
    await storeA.storeEvent('_GET_stream', msg(3))
    const sent: JSONRPCMessage[] = []
    await storeA.replayEventsAfter(aFirst, { send: async (_id, message) => void sent.push(message) })
    expect(sent).toEqual([msg(3)])
  })

  it('rejects a scope with characters outside the widened charset', () => {
    const store = new AdtEventStore('EvtT7')
    expect(() => {
      store.scope = "evil' or 1=1"
    }).toThrow(/invalid scope/)
  })

  it('retries once on a same-ms rowkey collision', async () => {
    const store = new AdtEventStore('EvtT9')
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
    const cryptoMod = await import('node:crypto')
    const mockedRandomBytes = cryptoMod.randomBytes as unknown as Mock
    // both storeEvent calls draw the same fixed bytes at the same fixed ms, forcing a real 409 on the second
    mockedRandomBytes.mockImplementationOnce(() => Buffer.from([0xaa, 0xaa]))
    mockedRandomBytes.mockImplementationOnce(() => Buffer.from([0xaa, 0xaa]))
    const e1 = await store.storeEvent('stream-x', msg(1))
    const e2 = await store.storeEvent('stream-x', msg(2))
    expect(e1).not.toBe(e2)
    nowSpy.mockRestore()
  })

  it('fork shares the table but carries an independent scope', async () => {
    const base = new AdtEventStore('EvtT8')
    const forkA = base.fork('sess-a')
    const forkB = base.fork('sess-b')
    const aFirst = await forkA.storeEvent('_GET_stream', msg(1))
    await tick()
    await forkB.storeEvent('_GET_stream', msg(2))
    await forkA.storeEvent('_GET_stream', msg(3))
    const sent: JSONRPCMessage[] = []
    await forkA.replayEventsAfter(aFirst, { send: async (_id, message) => void sent.push(message) })
    expect(sent).toEqual([msg(3)])
  })
})
