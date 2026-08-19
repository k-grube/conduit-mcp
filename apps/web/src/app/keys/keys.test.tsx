import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Page from './page'
import { SnackbarProvider } from '../../components/snackbar'
import type { ApiKey, CreateKeyResult } from '../../lib/key-queries'
import type { Role } from '../../lib/role-queries'

afterEach(() => {
  cleanup()
})

const { useApiKeys, useCreateApiKey, useDeleteApiKey } = vi.hoisted(() => ({
  useApiKeys: vi.fn(),
  useCreateApiKey: vi.fn(),
  useDeleteApiKey: vi.fn(),
}))

vi.mock('../../lib/key-queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/key-queries')>()
  return { ...actual, useApiKeys, useCreateApiKey, useDeleteApiKey }
})

const { useRoles } = vi.hoisted(() => ({ useRoles: vi.fn() }))
vi.mock('../../lib/role-queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/role-queries')>()
  return { ...actual, useRoles }
})

vi.mock('../../components/auth-gate', () => ({
  useAuth: () => ({ account: { name: 'Ada', username: 'ada@example.com', oid: 'oid-me' }, logout: vi.fn() }),
}))

function renderPage() {
  return render(
    <SnackbarProvider>
      <Page />
    </SnackbarProvider>,
  )
}

const mcpRole: Role = {
  id: 'halo-ro',
  name: 'Halo RO',
  grants: [],
  surfaces: ['mcp'],
  members: { users: [], groups: [] },
}

const portalOnlyRole: Role = {
  id: 'portal-admin',
  name: 'Portal Admin',
  grants: [],
  surfaces: ['portal'],
  members: { users: [], groups: [] },
}

const existingKey: ApiKey = {
  id: 'key-1',
  name: 'ci key',
  roleIds: ['halo-ro'],
  createdAt: '2026-01-01T00:00:00.000Z',
}

const createResult: CreateKeyResult = {
  id: 'key-2',
  name: 'ci key',
  roleIds: ['halo-ro'],
  rawKey: 'cmk_raw_secret_once',
}

function mockDefaults() {
  useRoles.mockReturnValue({ data: [mcpRole, portalOnlyRole], isLoading: false, isError: false, refetch: vi.fn() })
  useDeleteApiKey.mockReturnValue({ mutate: vi.fn(), isPending: false })
}

describe('api keys page', () => {
  it('create flow shows the rawKey exactly once, resets the mutation on capture, and clears local state on close', () => {
    mockDefaults()
    useApiKeys.mockReturnValue({ data: [], isLoading: false, isError: false, refetch: vi.fn() })
    const createMutate = vi.fn((_input, opts) => opts.onSuccess(createResult))
    const resetMock = vi.fn()
    useCreateApiKey.mockReturnValue({ mutate: createMutate, isPending: false, reset: resetMock })

    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Create key' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'ci key' } })

    fireEvent.mouseDown(screen.getByRole('combobox'))
    fireEvent.click(screen.getByRole('option', { name: 'Halo RO' }))
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' })

    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    expect(createMutate).toHaveBeenCalledWith({ name: 'ci key', roleIds: ['halo-ro'] }, expect.anything())
    expect(screen.getByDisplayValue('cmk_raw_secret_once')).toBeTruthy()
    expect(screen.getByText('Shown once, store it now.')).toBeTruthy()
    // rawKey moves to local state and the mutation resets immediately, cache never holds the plaintext
    expect(resetMock).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    expect(screen.queryByDisplayValue('cmk_raw_secret_once')).toBeNull()
  })

  it('only offers mcp-surface roles in the create dialog', () => {
    mockDefaults()
    useApiKeys.mockReturnValue({ data: [], isLoading: false, isError: false, refetch: vi.fn() })
    useCreateApiKey.mockReturnValue({ mutate: vi.fn(), isPending: false, reset: vi.fn() })

    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Create key' }))
    fireEvent.mouseDown(screen.getByRole('combobox'))

    const listbox = screen.getByRole('listbox')
    expect(within(listbox).getByText('Halo RO')).toBeTruthy()
    expect(within(listbox).queryByText('Portal Admin')).toBeNull()
  })

  it('rotate calls create then delete in order, and resets the mutation on capture', () => {
    mockDefaults()
    useApiKeys.mockReturnValue({ data: [existingKey], isLoading: false, isError: false, refetch: vi.fn() })
    const order: string[] = []
    const createMutate = vi.fn((_input, opts) => {
      order.push('create')
      opts.onSuccess(createResult)
    })
    const deleteMutate = vi.fn(() => {
      order.push('delete')
    })
    const resetMock = vi.fn()
    useCreateApiKey.mockReturnValue({ mutate: createMutate, isPending: false, reset: resetMock })
    useDeleteApiKey.mockReturnValue({ mutate: deleteMutate, isPending: false })

    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Rotate key' }))

    expect(createMutate).toHaveBeenCalledWith({ name: 'ci key', roleIds: ['halo-ro'] }, expect.anything())
    expect(resetMock).toHaveBeenCalledTimes(1)
    expect(deleteMutate).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    expect(deleteMutate).toHaveBeenCalledWith('key-1', expect.anything())
    expect(order).toEqual(['create', 'delete'])
  })

  it('rotate does not fire while a rotation is already in flight, and the control is disabled', () => {
    mockDefaults()
    useApiKeys.mockReturnValue({ data: [existingKey], isLoading: false, isError: false, refetch: vi.fn() })
    const createMutate = vi.fn()
    useCreateApiKey.mockReturnValue({ mutate: createMutate, isPending: true, reset: vi.fn() })

    renderPage()

    const rotateButton = screen.getByRole('button', { name: 'Rotate key' })
    expect((rotateButton as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(rotateButton)

    expect(createMutate).not.toHaveBeenCalled()
  })
})
