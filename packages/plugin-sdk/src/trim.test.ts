import { describe, expect, it } from 'vitest'
import { stripHtml, trimResponse } from './trim.js'

describe('stripHtml', () => {
  it('converts br and block tags to newlines and strips the rest', () => {
    const html = '<p>hello<br>world</p><div>next</div>'
    expect(stripHtml(html)).toBe('hello\nworld\nnext')
  })

  it('decodes common entities', () => {
    expect(stripHtml('a&amp;b &lt;tag&gt; &quot;q&quot; &#39;s&#39; x&nbsp;y')).toBe('a&b <tag> "q" \'s\' x y')
  })

  it('collapses runs of blank lines and repeated spaces', () => {
    expect(stripHtml('a\n\n\n\nb   c')).toBe('a\n\nb c')
  })
})

describe('trimResponse', () => {
  it('passes short strings through unchanged', () => {
    expect(trimResponse('short')).toBe('short')
  })

  it('passes non-string values through unchanged when under the warn threshold', () => {
    const value = { a: 1, b: 'two' }
    expect(trimResponse(value)).toBe(value)
  })

  it('warns but does not truncate between warn and max size', () => {
    const text = 'x'.repeat(25_000)
    const result = trimResponse(text) as string
    expect(result.startsWith(text)).toBe(true)
    expect(result).toContain('[Large response: 25000 characters')
  })

  it('truncates and appends a marker over max size', () => {
    const text = 'x'.repeat(60_000)
    const result = trimResponse(text) as string
    expect(result.length).toBeLessThan(text.length)
    expect(result).toContain('[Response trimmed from 60000 to 50000 characters')
    expect(result.startsWith('x'.repeat(50_000))).toBe(true)
  })

  it('stringifies non-string values before measuring and trimming', () => {
    const value = { items: Array.from({ length: 5000 }, (_, i) => ({ id: i, name: `item-${i}` })) }
    const result = trimResponse(value) as string
    expect(typeof result).toBe('string')
    expect(result).toContain('[Response trimmed')
  })

  it('returns undefined unchanged instead of crashing on JSON.stringify(undefined)', () => {
    expect(trimResponse(undefined)).toBeUndefined()
  })

  it('returns a circular object unchanged instead of crashing on JSON.stringify', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const circular: any = { a: 1 }
    circular.self = circular
    expect(trimResponse(circular)).toBe(circular)
  })

  it('includes record count in the truncation message when provided', () => {
    const text = 'x'.repeat(60_000)
    const result = trimResponse(text, 123) as string
    expect(result).toContain('[Response trimmed from 123 records from 60000 to 50000 characters')
  })

  it('includes record count in the warn message when provided', () => {
    const text = 'x'.repeat(25_000)
    const result = trimResponse(text, 7) as string
    expect(result).toContain('[Large response from 7 records: 25000 characters')
  })
})
