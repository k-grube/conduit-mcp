import type { TableClient } from '@azure/data-tables'
import { ensureTable, getJsonRow } from './tables.js'

type Json = Record<string, unknown>

export function deepMerge(base: Json, patch: Json): Json {
  const out: Json = { ...base }
  for (const [k, v] of Object.entries(patch)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') {
      continue
    }
    const prev = out[k]
    if (v && typeof v === 'object' && !Array.isArray(v) && prev && typeof prev === 'object' && !Array.isArray(prev)) {
      out[k] = deepMerge(prev as Json, v as Json)
    } else {
      out[k] = v
    }
  }
  return out
}

interface CacheEntry {
  value: Json
  at: number
}

export class ConfigStore {
  private tableName: string
  private ttlMs: number
  private client?: TableClient
  private cache = new Map<string, CacheEntry>()
  private listeners = new Set<(domain: string) => void>()

  constructor(opts: { tableName?: string; ttlMs?: number } = {}) {
    this.tableName = opts.tableName ?? 'Config'
    this.ttlMs = opts.ttlMs ?? 60_000
  }

  private async table(): Promise<TableClient> {
    if (!this.client) {
      this.client = await ensureTable(this.tableName)
    }
    return this.client
  }

  private async read(domain: string): Promise<{ value: Json; etag?: string }> {
    const table = await this.table()
    const row = await getJsonRow<Json>(table, 'config', domain)
    return row ?? { value: {} }
  }

  async getDomain<T extends Json>(domain: string): Promise<T> {
    const hit = this.cache.get(domain)
    if (hit && Date.now() - hit.at < this.ttlMs) {
      return structuredClone(hit.value) as T
    }
    const { value } = await this.read(domain)
    this.cache.set(domain, { value, at: Date.now() })
    return structuredClone(value) as T
  }

  async updateDomain(domain: string, patch: Json): Promise<void> {
    const table = await this.table()
    const attempt = async (): Promise<void> => {
      const { value, etag } = await this.read(domain)
      const merged = deepMerge(value, patch)
      const entity = { partitionKey: 'config', rowKey: domain, json: JSON.stringify(merged) }
      if (etag) {
        await table.updateEntity(entity, 'Replace', { etag })
      } else {
        await table.createEntity(entity)
      }
    }
    try {
      await attempt()
    } catch (err) {
      const code = (err as { statusCode?: number }).statusCode
      // 412 stale etag, 409 concurrent create: re-read once and retry
      if (code === 412 || code === 409) {
        await attempt()
      } else {
        throw err
      }
    }
    this.cache.delete(domain)
    for (const cb of this.listeners) {
      try {
        cb(domain)
      } catch {
        // listeners must not fail a committed write
      }
    }
  }

  onChange(cb: (domain: string) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }
}
