import { describe, expect, it, vi } from 'vitest'
import { checkForUpdate, createUpdateCache, restartSite, siteFromEnv, updateNotice } from './system.js'

const IMAGE_ENV = { CONDUIT_IMAGE_REF: 'ghcr.io/k-grube/conduit-mcp:latest', CONDUIT_IMAGE_SHA: 'aaa111' }

interface GhcrFixture {
  index?: unknown
  manifest: unknown
  configBlob?: unknown
}

function ghcrFetch(fx: GhcrFixture) {
  return vi.fn(async (url: string | URL | Request) => {
    const u = String(url)
    if (u.includes('/token?')) {
      return new Response(JSON.stringify({ token: 'anon' }), { status: 200 })
    }
    if (u.includes('/manifests/latest')) {
      return new Response(JSON.stringify(fx.index ?? fx.manifest), { status: 200 })
    }
    if (u.includes('/manifests/sha256:child')) {
      return new Response(JSON.stringify(fx.manifest), { status: 200 })
    }
    if (u.includes('/blobs/')) {
      return new Response(JSON.stringify(fx.configBlob ?? {}), { status: 200 })
    }
    return new Response('not found', { status: 404 })
  })
}

describe('checkForUpdate', () => {
  it('reports unavailable without baked image identity', async () => {
    const status = await checkForUpdate({}, vi.fn() as unknown as typeof fetch)
    expect(status.unavailable).toMatch(/not baked/)
    expect(status.updateAvailable).toBeUndefined()
  })

  it('reports unavailable for non-ghcr refs', async () => {
    const status = await checkForUpdate(
      { CONDUIT_IMAGE_REF: 'example.azurecr.io/x:latest', CONDUIT_IMAGE_SHA: 'aaa' },
      vi.fn() as unknown as typeof fetch,
    )
    expect(status.unavailable).toMatch(/ghcr/)
  })

  it('compares the revision label from a bare manifest config blob', async () => {
    const f = ghcrFetch({
      manifest: { config: { digest: 'sha256:cfg' } },
      configBlob: { config: { Labels: { 'org.opencontainers.image.revision': 'bbb222' } } },
    })
    const status = await checkForUpdate(IMAGE_ENV, f as unknown as typeof fetch)
    expect(status).toMatchObject({ runningSha: 'aaa111', remoteSha: 'bbb222', tag: 'latest', updateAvailable: true })
  })

  it('walks a buildx index to the linux/amd64 child, ignoring attestation entries', async () => {
    const f = ghcrFetch({
      index: {
        manifests: [
          { digest: 'sha256:attest', platform: { architecture: 'unknown', os: 'unknown' } },
          { digest: 'sha256:child', platform: { architecture: 'amd64', os: 'linux' } },
        ],
      },
      manifest: { annotations: { 'org.opencontainers.image.revision': 'aaa111' } },
    })
    const status = await checkForUpdate(IMAGE_ENV, f as unknown as typeof fetch)
    expect(status).toMatchObject({ remoteSha: 'aaa111', updateAvailable: false })
    expect(f.mock.calls.some((c) => String(c[0]).includes('sha256:attest'))).toBe(false)
  })

  it('reports unavailable when the image has no revision label', async () => {
    const f = ghcrFetch({ manifest: { config: { digest: 'sha256:cfg' } }, configBlob: { config: { Labels: {} } } })
    const status = await checkForUpdate(IMAGE_ENV, f as unknown as typeof fetch)
    expect(status.unavailable).toMatch(/no revision label/)
  })

  it('throws on registry errors', async () => {
    const f = vi.fn(async () => new Response('down', { status: 503 }))
    await expect(checkForUpdate(IMAGE_ENV, f as unknown as typeof fetch)).rejects.toThrow(/503/)
  })
})

describe('createUpdateCache', () => {
  const freshFetch = () =>
    ghcrFetch({
      manifest: { config: { digest: 'sha256:cfg' } },
      configBlob: { config: { Labels: { 'org.opencontainers.image.revision': 'bbb222' } } },
    })

  it('check() does a live round trip and caches the result for peek()', async () => {
    const f = freshFetch()
    const cache = createUpdateCache(IMAGE_ENV, f as unknown as typeof fetch)
    const status = await cache.check()
    expect(status.updateAvailable).toBe(true)
    expect(cache.peek()).toEqual(status)
  })

  it('peek() within ttl never refetches', async () => {
    const f = freshFetch()
    const cache = createUpdateCache(IMAGE_ENV, f as unknown as typeof fetch)
    await cache.check()
    const calls = f.mock.calls.length
    cache.peek()
    cache.peek()
    expect(f.mock.calls.length).toBe(calls)
  })

  it('empty cache peek() returns undefined and fills in the background', async () => {
    const f = freshFetch()
    const cache = createUpdateCache(IMAGE_ENV, f as unknown as typeof fetch)
    expect(cache.peek()).toBeUndefined()
    await vi.waitFor(() => expect(cache.peek()).toBeDefined())
  })

  it('expired cache peek() serves nothing and refreshes in the background', async () => {
    let now = 0
    const f = freshFetch()
    const cache = createUpdateCache(IMAGE_ENV, f as unknown as typeof fetch, {
      ttlMs: 1000,
      cooldownMs: 0,
      now: () => now,
    })
    await cache.check()
    now = 1001
    expect(cache.peek()).toBeUndefined()
    await vi.waitFor(() => expect(cache.peek()).toBeDefined())
  })

  it('get() serves a fresh cached value without fetching', async () => {
    const f = freshFetch()
    const cache = createUpdateCache(IMAGE_ENV, f as unknown as typeof fetch)
    const status = await cache.check()
    const calls = f.mock.calls.length
    expect(await cache.get()).toEqual(status)
    expect(f.mock.calls.length).toBe(calls)
  })

  it('get() falls back to a live check when the cache is stale', async () => {
    let now = 0
    const f = freshFetch()
    const cache = createUpdateCache(IMAGE_ENV, f as unknown as typeof fetch, { ttlMs: 1000, now: () => now })
    await cache.check()
    const calls = f.mock.calls.length
    now = 1001
    expect((await cache.get()).updateAvailable).toBe(true)
    expect(f.mock.calls.length).toBeGreaterThan(calls)
  })

  it('background refresh failures are swallowed and cool down before retrying', async () => {
    let now = 0
    const f = vi.fn(async () => new Response('down', { status: 503 }))
    const cache = createUpdateCache(IMAGE_ENV, f as unknown as typeof fetch, { cooldownMs: 5000, now: () => now })
    expect(cache.peek()).toBeUndefined()
    // let the failed refresh settle before counting
    await new Promise((r) => setTimeout(r, 0))
    const calls = f.mock.calls.length
    expect(calls).toBeGreaterThan(0)
    cache.peek()
    expect(f.mock.calls.length).toBe(calls)
    now = 5001
    cache.peek()
    expect(f.mock.calls.length).toBe(calls + 1)
  })
})

describe('updateNotice', () => {
  it('describes an available update with short shas', () => {
    const status = {
      runningSha: 'aaa111222333444',
      remoteSha: 'bbb222333444555',
      tag: 'latest',
      updateAvailable: true,
    }
    expect(updateNotice(status)).toBe(
      'A conduit-mcp server update is available: running aaa1112, the latest tag now points at bbb2223. ' +
        'Mention this to the user; a portal admin can apply it from the settings page (Restart server).',
    )
  })

  it('returns undefined when up to date, unknown, or unavailable', () => {
    expect(updateNotice(undefined)).toBeUndefined()
    expect(updateNotice({ runningSha: 'aaa', remoteSha: 'aaa', updateAvailable: false })).toBeUndefined()
    expect(updateNotice({ unavailable: 'image identity not baked into this build' })).toBeUndefined()
  })
})

const SITE_ENV = {
  WEBSITE_OWNER_NAME: 'sub-1+conduit-rg-westus2webspace',
  WEBSITE_RESOURCE_GROUP: 'conduit-rg',
  WEBSITE_SITE_NAME: 'conduit-app-x',
}

describe('restartSite', () => {
  const credential = { getToken: vi.fn(async () => ({ token: 'mi-tok', expiresOnTimestamp: 0 })) }

  it('parses site identity from app service env', () => {
    expect(siteFromEnv(SITE_ENV)).toEqual({ subscription: 'sub-1', rg: 'conduit-rg', site: 'conduit-app-x' })
    expect(siteFromEnv({})).toBeUndefined()
  })

  it('POSTs the ARM restart action with a management token', async () => {
    const f = vi.fn(async () => new Response('', { status: 200 }))
    await restartSite(SITE_ENV, credential, f as unknown as typeof fetch)
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(
      'https://management.azure.com/subscriptions/sub-1/resourceGroups/conduit-rg/providers/Microsoft.Web/sites/conduit-app-x/restart?api-version=2024-04-01',
    )
    expect(init.method).toBe('POST')
    expect(init.redirect).toBe('error')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer mi-tok')
    expect(credential.getToken).toHaveBeenCalledWith('https://management.azure.com/.default')
  })

  it('throws off app service', async () => {
    await expect(restartSite({}, credential, vi.fn() as unknown as typeof fetch)).rejects.toThrow(/app service/)
  })

  it('throws on ARM failure', async () => {
    const f = vi.fn(async () => new Response('', { status: 403 }))
    await expect(restartSite(SITE_ENV, credential, f as unknown as typeof fetch)).rejects.toThrow(/403/)
  })
})
