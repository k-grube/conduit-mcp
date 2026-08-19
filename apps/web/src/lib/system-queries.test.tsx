import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useUpdateStatus } from './system-queries'

const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }))
vi.mock('./api', () => ({ api: { get: apiGet } }))

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

describe('useUpdateStatus', () => {
  it('hits the cached endpoint by default', async () => {
    apiGet.mockResolvedValue({ status: 200, data: { updateAvailable: false } })
    const { result } = renderHook(() => useUpdateStatus(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(apiGet).toHaveBeenCalledWith('/api/admin/system/update')
  })

  it('adds live=1 when a live check is requested', async () => {
    apiGet.mockResolvedValue({ status: 200, data: { updateAvailable: false } })
    const { result } = renderHook(() => useUpdateStatus({ live: true }), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(apiGet).toHaveBeenCalledWith('/api/admin/system/update?live=1')
  })
})
