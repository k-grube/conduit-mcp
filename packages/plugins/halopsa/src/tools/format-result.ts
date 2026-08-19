// list-shaped results run through this before the 50kb trimResponse pass, capping item
// count at 100 with a truncated marker so a big page gets a clean item-boundary cut
// instead of a mid-json slice
import { trimResponse } from '@conduit-mcp/plugin-sdk'
import { pickFields } from '../fields.js'

const DEFAULT_MAX_ITEMS = 100

type HaloClient = { baseUrl: string }
type TransformItem = (
  item: Record<string, unknown>,
  client: HaloClient,
) => Record<string, unknown> | Promise<Record<string, unknown>>

export interface FormatListResultOptions {
  collectionKey?: string
  fields?: readonly string[]
  transformItem?: TransformItem
  maxItems?: number
}

export async function formatListResult(
  result: unknown,
  client: HaloClient,
  opts: FormatListResultOptions = {},
): Promise<unknown> {
  const limit = opts.maxItems ?? DEFAULT_MAX_ITEMS
  const { collectionKey, fields, transformItem } = opts

  if (collectionKey && result && typeof result === 'object' && collectionKey in result) {
    const d = result as Record<string, unknown>
    let items = Array.isArray(d[collectionKey]) ? (d[collectionKey] as Record<string, unknown>[]) : null
    if (items) {
      const totalItems = items.length
      if (transformItem) {
        items = await Promise.all(items.map((item) => transformItem(item, client)))
      }
      if (fields) {
        items = items.map((item) => pickFields(item, fields))
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
        [collectionKey]: items,
      }
      return trimResponse(trimmed, totalItems)
    }
    const trimmed = {
      page_no: d.page_no,
      page_size: d.page_size,
      record_count: d.record_count,
      [collectionKey]: d[collectionKey],
    }
    return trimResponse(trimmed)
  }

  // raw arrays (non-collection-key responses, e.g. halopsa_get_outcomes/get_statuses)
  if (Array.isArray(result)) {
    const totalItems = result.length
    let items = result as Record<string, unknown>[]
    if (transformItem) {
      items = await Promise.all(items.map((item) => transformItem(item, client)))
    }
    if (fields) {
      items = items.map((item) => pickFields(item, fields))
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
    if (transformItem) {
      item = await transformItem(item, client)
    }
    if (fields) {
      item = pickFields(item, fields) as Record<string, unknown>
    }
    return trimResponse(item)
  }
  return trimResponse(result)
}
