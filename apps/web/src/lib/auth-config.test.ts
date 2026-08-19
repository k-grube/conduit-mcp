import { afterEach, describe, expect, it, vi } from 'vitest'
import { getAuthConfig } from './auth-config'

describe('getAuthConfig', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('clears the module cache on rejection so the next call refetches', async () => {
    const fetchMock = vi.fn()
    fetchMock.mockRejectedValueOnce(new Error('network down'))
    fetchMock.mockResolvedValueOnce({ json: async () => ({ configured: false }) })
    vi.stubGlobal('fetch', fetchMock)

    await expect(getAuthConfig()).rejects.toThrow('network down')

    const cfg = await getAuthConfig()

    expect(cfg).toEqual({ configured: false })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
