import { describe, expect, it } from 'vitest'
import { tagList } from './settings.js'

describe('tagList', () => {
  it('trims array entries and drops empties and non-strings', () => {
    expect(tagList(['  a  ', '', 7, null, 'b'])).toEqual(['a', 'b'])
  })

  it('splits a comma-string saved before the field became tags', () => {
    expect(tagList('a, b ,, c')).toEqual(['a', 'b', 'c'])
  })

  it('returns empty for undefined and non-list values', () => {
    expect(tagList(undefined)).toEqual([])
    expect(tagList(42)).toEqual([])
    expect(tagList('  ')).toEqual([])
  })
})
