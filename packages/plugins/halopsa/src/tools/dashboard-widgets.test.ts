import { describe, expect, it } from 'vitest'
import {
  parseLayouts,
  serializeLayouts,
  nextWidgetKey,
  autoPlace,
  layoutsWithAdded,
  layoutsWithGeometry,
  layoutsPruned,
} from './dashboard-widgets.js'

describe('parseLayouts', () => {
  it('parses a valid layouts json string', () => {
    const raw = JSON.stringify({ lg: [{ i: '1', x: 0, y: 0, w: 4, h: 3, moved: false, static: false }] })
    expect(parseLayouts(raw)).toEqual({ lg: [{ i: '1', x: 0, y: 0, w: 4, h: 3, moved: false, static: false }] })
  })

  it('returns empty object for blank, malformed, or non-object input', () => {
    expect(parseLayouts(undefined)).toEqual({})
    expect(parseLayouts('')).toEqual({})
    expect(parseLayouts('not json')).toEqual({})
    expect(parseLayouts('[]')).toEqual({})
  })
})

describe('serializeLayouts', () => {
  it('round-trips through parseLayouts', () => {
    const layouts = { lg: [{ i: '1', x: 0, y: 0, w: 4, h: 3, moved: false, static: false }] }
    expect(parseLayouts(serializeLayouts(layouts))).toEqual(layouts)
  })
})

describe('nextWidgetKey', () => {
  it('returns 1 for no widgets', () => {
    expect(nextWidgetKey([])).toBe('1')
  })

  it('returns max(i) + 1', () => {
    expect(nextWidgetKey([{ i: '3' }, { i: '1' }, { i: '7' }])).toBe('8')
  })

  it('ignores non-numeric i values', () => {
    expect(nextWidgetKey([{ i: 'abc' }, { i: '2' }])).toBe('3')
  })
})

describe('autoPlace', () => {
  it('places at 0,0 with no lg entries', () => {
    expect(autoPlace({}, 4, 3)).toEqual({ x: 0, y: 0 })
  })

  it('places below the lowest lg entry', () => {
    const layouts = { lg: [{ i: '1', x: 0, y: 0, w: 4, h: 3, moved: false, static: false }] }
    expect(autoPlace(layouts, 4, 3)).toEqual({ x: 0, y: 3 })
  })
})

describe('layoutsWithAdded', () => {
  it('creates an lg breakpoint when layouts is empty', () => {
    const result = layoutsWithAdded({}, '1', { x: 0, y: 0, w: 4, h: 3 })
    expect(result).toEqual({ lg: [{ i: '1', x: 0, y: 0, w: 4, h: 3, moved: false, static: false }] })
  })

  it('appends the entry to every existing breakpoint', () => {
    const layouts = {
      lg: [{ i: '1', x: 0, y: 0, w: 4, h: 3, moved: false, static: false }],
      sm: [{ i: '1', x: 0, y: 0, w: 2, h: 3, moved: false, static: false }],
    }
    const result = layoutsWithAdded(layouts, '2', { x: 4, y: 0, w: 4, h: 3 })
    expect(result.lg).toHaveLength(2)
    expect(result.sm).toHaveLength(2)
  })
})

describe('layoutsWithGeometry', () => {
  it('updates geometry only for the matching entry across all breakpoints', () => {
    const layouts = {
      lg: [
        { i: '1', x: 0, y: 0, w: 4, h: 3, moved: false, static: false },
        { i: '2', x: 4, y: 0, w: 4, h: 3, moved: false, static: false },
      ],
    }
    const result = layoutsWithGeometry(layouts, '1', { w: 8 })
    expect(result.lg[0]).toMatchObject({ i: '1', w: 8 })
    expect(result.lg[1]).toMatchObject({ i: '2', w: 4 })
  })
})

describe('layoutsPruned', () => {
  it('drops entries whose i is not in keepKeys', () => {
    const layouts = {
      lg: [
        { i: '1', x: 0, y: 0, w: 4, h: 3, moved: false, static: false },
        { i: '2', x: 4, y: 0, w: 4, h: 3, moved: false, static: false },
      ],
    }
    const result = layoutsPruned(layouts, new Set(['1']))
    expect(result.lg).toEqual([{ i: '1', x: 0, y: 0, w: 4, h: 3, moved: false, static: false }])
  })
})
