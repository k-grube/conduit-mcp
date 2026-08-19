const WARN_RESPONSE_SIZE = 20_000
const MAX_RESPONSE_SIZE = 50_000

// strip html tags and collapse whitespace, cuts token usage on rich text fields
export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim()
}

// passthrough under warn size, truncated string with marker over max size, warned string in between
export function trimResponse(value: unknown, recordCount?: number): unknown {
  const text = stringify(value)
  // undefined (unstringifiable, e.g. bare undefined, function) or circular -> pass through untouched
  if (text === undefined) {
    return value
  }

  if (text.length <= WARN_RESPONSE_SIZE) {
    return value
  }

  const countInfo = recordCount != null ? ` from ${recordCount} records` : ''

  if (text.length > MAX_RESPONSE_SIZE) {
    const trimmed = text.slice(0, MAX_RESPONSE_SIZE)
    return (
      trimmed +
      `\n\n[Response trimmed${countInfo} from ${text.length} to ${MAX_RESPONSE_SIZE} characters. Use more specific filters or pagination to reduce the result set.]`
    )
  }

  return (
    text +
    `\n\n[Large response${countInfo}: ${text.length} characters. Consider narrowing your query if this causes context issues.]`
  )
}

function stringify(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value
  }
  try {
    return JSON.stringify(value)
  } catch {
    return undefined
  }
}
