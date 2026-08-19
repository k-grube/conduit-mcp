import { describe, expect, it } from 'vitest'
import { createWriteGuard } from './write-guard.js'
import type { PluginStore } from './context.js'

function fakeStore(): PluginStore {
  const data = new Map<string, unknown>()
  return {
    async get<T>(key: string) {
      return data.get(key) as T | undefined
    },
    async set(key: string, value: unknown) {
      data.set(key, value)
    },
    async delete(key: string) {
      data.delete(key)
    },
  }
}

describe('createWriteGuard', () => {
  it('round-trips confirm -> commit for a matching payload', async () => {
    const guard = createWriteGuard(fakeStore())
    const payload = { ticketId: 42, status: 'closed' }

    const { confirmToken, preview } = await guard.confirm('close_ticket', payload)

    expect(preview).toEqual(payload)
    await expect(guard.commit('close_ticket', payload, confirmToken)).resolves.toBeUndefined()
  })

  it('rejects commit when the payload does not match what was confirmed', async () => {
    const guard = createWriteGuard(fakeStore())
    const { confirmToken } = await guard.confirm('close_ticket', { ticketId: 42 })

    await expect(guard.commit('close_ticket', { ticketId: 43 }, confirmToken)).rejects.toThrow(/mismatch/)
  })

  it('rejects commit when the operation does not match what was confirmed', async () => {
    const guard = createWriteGuard(fakeStore())
    const payload = { ticketId: 42 }
    const { confirmToken } = await guard.confirm('close_ticket', payload)

    await expect(guard.commit('delete_ticket', payload, confirmToken)).rejects.toThrow(/mismatch/)
  })

  it('is order-independent when hashing object payloads', async () => {
    const guard = createWriteGuard(fakeStore())
    const { confirmToken } = await guard.confirm('close_ticket', { a: 1, b: 2 })

    await expect(guard.commit('close_ticket', { b: 2, a: 1 }, confirmToken)).resolves.toBeUndefined()
  })

  it('rejects a second commit with the same token (replay)', async () => {
    const guard = createWriteGuard(fakeStore())
    const payload = { ticketId: 42 }
    const { confirmToken } = await guard.confirm('close_ticket', payload)

    await guard.commit('close_ticket', payload, confirmToken)

    await expect(guard.commit('close_ticket', payload, confirmToken)).rejects.toThrow(/unknown confirm token/)
  })

  it('rejects an unknown confirm token', async () => {
    const guard = createWriteGuard(fakeStore())

    await expect(guard.commit('close_ticket', { ticketId: 42 }, 'not-a-real-token')).rejects.toThrow(
      /unknown confirm token/,
    )
  })

  it('rejects commit once the ttl has expired', async () => {
    const store = fakeStore()
    const guard = createWriteGuard(store)
    const payload = { ticketId: 42 }
    const { confirmToken } = await guard.confirm('close_ticket', payload)

    // force the stored entry to look 601s old
    const entry = await store.get<{ payloadHash: string; storedAt: number }>('write-guard:' + confirmToken)
    await store.set('write-guard:' + confirmToken, { ...entry, storedAt: Date.now() - 601_000 })

    await expect(guard.commit('close_ticket', payload, confirmToken)).rejects.toThrow(/expired/)
  })
})
