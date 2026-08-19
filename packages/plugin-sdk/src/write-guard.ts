import crypto from 'node:crypto'
import type { PluginStore } from './context.js'

const TTL_MS = 600_000
const STORE_PREFIX = 'write-guard:'

export interface WriteGuard {
  confirm(operation: string, payload: unknown): Promise<{ confirmToken: string; preview: unknown }>
  commit(operation: string, payload: unknown, confirmToken: string): Promise<void>
}

interface PendingWrite {
  payloadHash: string
  storedAt: number
}

// stable stringify, sorted keys, so hash is independent of property order
function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalize).join(',') + ']'
  }
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalize(obj[k])).join(',') + '}'
}

// operation folded into the hash, so a confirm for one operation can't commit as another
function hashPayload(operation: string, payload: unknown): string {
  return crypto.createHash('sha256').update(canonicalize({ operation, payload })).digest('hex')
}

function hashesEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex')
  const bufB = Buffer.from(b, 'hex')
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB)
}

export function createWriteGuard(store: PluginStore): WriteGuard {
  return {
    async confirm(operation, payload) {
      const confirmToken = crypto.randomBytes(16).toString('hex')
      const entry: PendingWrite = { payloadHash: hashPayload(operation, payload), storedAt: Date.now() }
      await store.set(STORE_PREFIX + confirmToken, entry)
      return { confirmToken, preview: payload }
    },

    async commit(operation, payload, confirmToken) {
      const key = STORE_PREFIX + confirmToken
      const entry = await store.get<PendingWrite>(key)
      if (!entry) {
        throw new Error('write guard: unknown confirm token')
      }
      if (Date.now() - entry.storedAt >= TTL_MS) {
        throw new Error('write guard: confirm token expired')
      }
      if (!hashesEqual(entry.payloadHash, hashPayload(operation, payload))) {
        throw new Error('write guard: payload mismatch')
      }
      // single-use, delete on successful commit
      await store.delete(key)
    },
  }
}
