import type { AxiosAdapter } from 'axios'
import { describe, expect, it, vi } from 'vitest'
import { createApi } from './api'

function fakeAdapter(handler: (config: Parameters<AxiosAdapter>[0]) => Promise<{ status: number; data?: unknown }>) {
  const adapter: AxiosAdapter = async (config) => {
    const { status, data } = await handler(config)
    if (status >= 200 && status < 300) {
      return { data, status, statusText: 'OK', headers: {}, config }
    }
    const err = Object.assign(new Error(`request failed with status ${status}`), {
      isAxiosError: true,
      config,
      response: { data, status, statusText: 'error', headers: {}, config },
      toJSON: () => ({}),
    })
    throw err
  }
  return adapter
}

describe('createApi', () => {
  it('attaches the token to request headers', async () => {
    let seenAuth: unknown
    const client = createApi(async () => 'tok123', vi.fn())
    client.defaults.adapter = fakeAdapter(async (config) => {
      seenAuth = config.headers.Authorization
      return { status: 200, data: { ok: true } }
    })

    await client.get('/foo')

    expect(seenAuth).toBe('Bearer tok123')
  })

  it('calls onUnauthorized exactly once on a 401', async () => {
    const onUnauthorized = vi.fn()
    const client = createApi(async () => 'tok123', onUnauthorized)
    client.defaults.adapter = fakeAdapter(async () => ({ status: 401 }))

    await expect(client.get('/foo')).rejects.toThrow()

    expect(onUnauthorized).toHaveBeenCalledTimes(1)
  })

  it('passes non-401 errors through untouched', async () => {
    const onUnauthorized = vi.fn()
    const client = createApi(async () => 'tok123', onUnauthorized)
    client.defaults.adapter = fakeAdapter(async () => ({ status: 500 }))

    await expect(client.get('/foo')).rejects.toMatchObject({ response: { status: 500 } })

    expect(onUnauthorized).not.toHaveBeenCalled()
  })
})
