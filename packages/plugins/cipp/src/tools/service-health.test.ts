import { describe, expect, it, vi } from 'vitest'
import { fetchServiceHealth, matchRegion } from './service-health.js'

const sampleData = {
  timestamp: '2026-01-01T00:00:00Z',
  totalRegions: 3,
  regions: [
    { name: 'US West', code: 'westus2', status: 'good', serviceEvents: [] },
    { name: 'US East', code: 'eastus', status: 'good', serviceEvents: [] },
    { name: 'Brazil South', code: 'brazilsouth', status: 'good', serviceEvents: [] },
  ],
}

describe('matchRegion', () => {
  it('matches a region by simple substring', () => {
    expect(matchRegion('brazil', sampleData.regions[2])).toBe(true)
  })

  it('matches the azure naming-flip case (word order reversed from the code)', () => {
    expect(matchRegion('uswest', sampleData.regions[0])).toBe(true)
  })

  it('strips trailing digits so uswest also matches westus2', () => {
    expect(matchRegion('west us', sampleData.regions[0])).toBe(true)
  })

  it('returns false for a non-matching region', () => {
    expect(matchRegion('brazil', sampleData.regions[0])).toBe(false)
  })
})

describe('fetchServiceHealth', () => {
  it('fetches the public feed via the injected fetchFn, no auth needed', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toBe('https://status.cipp.app/data/serviceHealth.json')
      return new Response(JSON.stringify(sampleData), { status: 200 })
    })

    const result = await fetchServiceHealth(undefined, fetchFn)

    expect(result.regions).toHaveLength(3)
  })

  it('filters regions by the fuzzy region list when provided', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify(sampleData), { status: 200 }))

    const result = await fetchServiceHealth(['uswest'], fetchFn)

    expect(result.regions).toEqual([sampleData.regions[0]])
  })

  it('throws on a non-ok response', async () => {
    const fetchFn = vi.fn(async () => new Response('boom', { status: 503, statusText: 'Service Unavailable' }))

    await expect(fetchServiceHealth(undefined, fetchFn)).rejects.toThrow(/503/)
  })
})
