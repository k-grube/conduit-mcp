// layouts JSON is client-owned (react-grid-layout, keys lg/md/sm/xs/xxs, keyed by widget i), server never syncs it

export const REPORT_BACKED_TYPES = new Set(['report_data', 'report_chart', 'report_counter'])

export interface LayoutEntry {
  i: string
  x: number
  y: number
  w: number
  h: number
  moved: boolean
  static: boolean
}

export type Layouts = Record<string, LayoutEntry[]>

export function parseLayouts(raw: unknown): Layouts {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return {}
  }
  try {
    const parsed = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {}
    }
    const out: Layouts = {}
    for (const [key, entries] of Object.entries(parsed)) {
      if (Array.isArray(entries)) {
        out[key] = entries as LayoutEntry[]
      }
    }
    return out
  } catch {
    return {}
  }
}

export function serializeLayouts(layouts: Layouts): string {
  return JSON.stringify(layouts)
}

export function nextWidgetKey(widgets: Array<{ i?: unknown }>): string {
  let max = 0
  for (const w of widgets) {
    const n = Number.parseInt(String(w.i), 10)
    if (Number.isFinite(n) && n > max) {
      max = n
    }
  }
  return String(max + 1)
}

export function autoPlace(layouts: Layouts, _w: number, _h: number): { x: number; y: number } {
  const lg = layouts.lg ?? []
  let bottom = 0
  for (const entry of lg) {
    if (entry.y + entry.h > bottom) {
      bottom = entry.y + entry.h
    }
  }
  return { x: 0, y: bottom }
}

export function layoutsWithAdded(
  layouts: Layouts,
  i: string,
  geom: { x: number; y: number; w: number; h: number },
): Layouts {
  const entry: LayoutEntry = { i, ...geom, moved: false, static: false }
  const keys = Object.keys(layouts)
  if (keys.length === 0) {
    return { lg: [entry] }
  }
  const out: Layouts = {}
  for (const key of keys) {
    out[key] = [...layouts[key], { ...entry }]
  }
  return out
}

export function layoutsWithGeometry(
  layouts: Layouts,
  i: string,
  geom: Partial<{ x: number; y: number; w: number; h: number }>,
): Layouts {
  const out: Layouts = {}
  for (const [key, entries] of Object.entries(layouts)) {
    out[key] = entries.map((e) => (e.i === i ? { ...e, ...geom } : e))
  }
  return out
}

export function layoutsPruned(layouts: Layouts, keepKeys: Set<string>): Layouts {
  const out: Layouts = {}
  for (const [key, entries] of Object.entries(layouts)) {
    out[key] = entries.filter((e) => keepKeys.has(e.i))
  }
  return out
}
