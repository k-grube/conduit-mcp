// /v2/queries/software has no server-side name filter, so name search pages the
// inventory and filters client-side. unscoped fleet-wide search can exceed one
// call, so we page to a per-call budget and hand back a cursor to resume.

export interface SoftwareClient {
  querySoftware(params?: Record<string, unknown>): Promise<unknown>
}

export interface SoftwareQueryArgs {
  name?: string
  df?: string
  pageSize?: number
  cursor?: string
  installedBefore?: string
  installedAfter?: string
}

interface SoftwarePage {
  results?: Record<string, unknown>[]
  cursor?: string
}

// tiny pages scan too few rows to be reliable, floor name scans here
const NAME_SCAN_PAGE_SIZE = 1000
// keep a single call under the MCP client timeout, caller resumes via returned cursor
const MAX_PAGES_PER_CALL = 10
const DISPLAY_CAP = 200

export async function queryNinjaSoftware(client: SoftwareClient, args: SoftwareQueryArgs): Promise<string> {
  const { name, cursor, pageSize, df, installedBefore, installedAfter } = args
  const lower = name ? name.toLowerCase() : undefined

  let effectivePageSize: number
  if (!lower) {
    effectivePageSize = pageSize ?? NAME_SCAN_PAGE_SIZE
  } else if (pageSize && pageSize >= 500) {
    effectivePageSize = pageSize
  } else {
    effectivePageSize = NAME_SCAN_PAGE_SIZE
  }
  // no name -> single page, never dump the whole fleet inventory
  const maxPages = lower ? MAX_PAGES_PER_CALL : 1

  const baseParams: Record<string, unknown> = {
    df,
    installedBefore,
    installedAfter,
    pageSize: effectivePageSize,
  }

  const matches: Record<string, unknown>[] = []
  let nextCursor: string | undefined = cursor
  let scanned = 0

  for (let page = 0; page < maxPages; page++) {
    const result = (await client.querySoftware({ ...baseParams, cursor: nextCursor })) as
      Record<string, unknown>[] | SoftwarePage
    const pageItems = Array.isArray(result) ? result : (result?.results ?? [])
    nextCursor = Array.isArray(result) ? undefined : result?.cursor
    scanned += pageItems.length

    if (lower) {
      for (const s of pageItems) {
        const n = String(s.name ?? s.productName ?? '').toLowerCase()
        if (n.includes(lower)) {
          matches.push(s)
        }
      }
    } else {
      matches.push(...pageItems)
    }

    if (!nextCursor || pageItems.length === 0) {
      nextCursor = undefined
      break
    }
  }

  const more = Boolean(nextCursor)
  const display = matches.slice(0, DISPLAY_CAP)
  const json = JSON.stringify(display, null, 2)

  const notes: string[] = []
  if (matches.length > DISPLAY_CAP) {
    notes.push(`Showing ${DISPLAY_CAP} of ${matches.length} results`)
  }
  if (more) {
    if (lower) {
      notes.push(
        `partial scan: ${scanned} rows checked, more devices unscanned, continue with cursor=${nextCursor} or narrow with df (e.g. df="org = 5")`,
      )
    } else {
      notes.push(`more results available, continue with cursor=${nextCursor}`)
    }
  }
  const suffix = notes.length > 0 ? `\n\n[${notes.join('. ')}]` : ''

  return json + suffix
}
