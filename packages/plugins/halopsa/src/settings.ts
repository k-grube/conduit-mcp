// tags fields arrive as string arrays, comma-strings from configs saved while they were text inputs
export function tagList(value: unknown): string[] {
  let raw: string[] = []
  if (Array.isArray(value)) {
    raw = value.filter((v): v is string => typeof v === 'string')
  } else if (typeof value === 'string') {
    raw = value.split(',')
  }
  return raw.map((s) => s.trim()).filter(Boolean)
}
