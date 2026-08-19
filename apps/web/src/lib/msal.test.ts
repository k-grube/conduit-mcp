import { describe, expect, it, vi } from 'vitest'
import { getMsal, portalScope } from './msal'

const { initialize, PublicClientApplicationMock } = vi.hoisted(() => {
  const initialize = vi.fn()
  // arrow functions can't be `new`-ed, msal.ts constructs this with `new`
  const PublicClientApplicationMock = vi.fn().mockImplementation(function FakePca() {
    return { initialize }
  })
  return { initialize, PublicClientApplicationMock }
})
vi.mock('@azure/msal-browser', () => ({ PublicClientApplication: PublicClientApplicationMock }))

describe('getMsal', () => {
  it('does not keep a broken singleton when initialize rejects, retries fresh next call', async () => {
    const cfg = { tenantId: 't1', clientId: 'c1', portalScope: 'api://c1/portal.access' }
    initialize.mockRejectedValueOnce(new Error('init failed'))
    initialize.mockResolvedValueOnce(undefined)

    await expect(getMsal(cfg)).rejects.toThrow('init failed')
    expect(() => portalScope()).toThrow('msal not initialized')

    const pca = await getMsal(cfg)

    expect(pca).toBeTruthy()
    expect(portalScope()).toBe('api://c1/portal.access')
    expect(PublicClientApplicationMock).toHaveBeenCalledTimes(2)
  })
})
