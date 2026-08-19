import { trimResponse } from '@conduit-mcp/plugin-sdk'
import type { NinjaClient } from './client.js'

type TransformItem = (item: Record<string, unknown>, client: NinjaClient) => Record<string, unknown>

export function pickFields<T extends Record<string, unknown>>(obj: T, fields: readonly string[]): Partial<T> {
  const result: Record<string, unknown> = {}
  for (const key of fields) {
    if (key in obj) {
      result[key] = obj[key]
    }
  }
  return result as Partial<T>
}

interface FormatOpts {
  collectionKey?: string
  fields?: readonly string[]
  transformItem?: TransformItem
  maxItems?: number
}

const DEFAULT_MAX_ITEMS = 100

// formats list-shaped results, returning the data value (trimResponse
// stringifies only when oversized) instead of a pre-stringified content envelope
export function formatResult(result: unknown, client: NinjaClient, opts: FormatOpts = {}): unknown {
  const limit = opts.maxItems ?? DEFAULT_MAX_ITEMS

  if (opts.collectionKey && result && typeof result === 'object' && opts.collectionKey in result) {
    const d = result as Record<string, unknown>
    let items = Array.isArray(d[opts.collectionKey]) ? (d[opts.collectionKey] as Record<string, unknown>[]) : null
    if (items) {
      const totalItems = items.length
      if (opts.transformItem) {
        items = items.map((item) => opts.transformItem!(item, client))
      }
      if (opts.fields) {
        items = items.map((item) => pickFields(item, opts.fields!))
      }
      const truncated = items.length > limit
      if (truncated) {
        items = items.slice(0, limit)
      }
      const trimmed = {
        page_no: d.page_no,
        page_size: d.page_size,
        record_count: d.record_count,
        returned: items.length,
        ...(truncated && { total_in_page: totalItems, truncated: true }),
        [opts.collectionKey]: items,
      }
      return trimResponse(trimmed, totalItems)
    }
    const trimmed = {
      page_no: d.page_no,
      page_size: d.page_size,
      record_count: d.record_count,
      [opts.collectionKey]: d[opts.collectionKey],
    }
    return trimResponse(trimmed)
  }

  // raw arrays (non-collection-key responses, most ninja endpoints)
  if (Array.isArray(result)) {
    const totalItems = result.length
    let items = result as Record<string, unknown>[]
    if (opts.transformItem) {
      items = items.map((item) => opts.transformItem!(item, client))
    }
    if (opts.fields) {
      items = items.map((item) => pickFields(item, opts.fields!))
    }
    const truncated = items.length > limit
    if (truncated) {
      items = items.slice(0, limit)
    }
    const wrapped = {
      returned: items.length,
      ...(truncated && { total: totalItems, truncated: true }),
      items,
    }
    return trimResponse(wrapped, totalItems)
  }

  if (result && typeof result === 'object') {
    let item = result as Record<string, unknown>
    if (opts.transformItem) {
      item = opts.transformItem(item, client)
    }
    if (opts.fields) {
      item = pickFields(item, opts.fields)
    }
    return trimResponse(item)
  }

  return trimResponse(result)
}
