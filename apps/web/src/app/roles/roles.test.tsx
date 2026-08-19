import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Page from './page'
import { SnackbarProvider } from '../../components/snackbar'
import type { Role } from '../../lib/role-queries'

afterEach(() => {
  cleanup()
})

vi.mock('../../components/auth-gate', () => ({
  useAuth: () => ({ account: { name: 'Ada', username: 'ada@example.com', oid: 'oid-me' }, logout: vi.fn() }),
}))

const { useTools } = vi.hoisted(() => ({ useTools: vi.fn() }))
vi.mock('../../lib/queries', () => ({ useTools }))

const { useRoles, useCreateRole, useUpdateRole, useUpdateRoleMembers, useDeleteRole } = vi.hoisted(() => ({
  useRoles: vi.fn(),
  useCreateRole: vi.fn(),
  useUpdateRole: vi.fn(),
  useUpdateRoleMembers: vi.fn(),
  useDeleteRole: vi.fn(),
}))

vi.mock('../../lib/role-queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/role-queries')>()
  return { ...actual, useRoles, useCreateRole, useUpdateRole, useUpdateRoleMembers, useDeleteRole }
})

// MemberPicker's graph search runs through real react-query (only the role/tool hooks are mocked above)
function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <SnackbarProvider>
        <Page />
      </SnackbarProvider>
    </QueryClientProvider>,
  )
}

const portalAdmin: Role = {
  id: 'portal-admin',
  name: 'Portal Admin',
  grants: [],
  surfaces: ['portal'],
  members: { users: ['oid-me'], groups: [] },
  builtin: true,
}

const customRole: Role = {
  id: 'halo-ro',
  name: 'Halo RO',
  grants: [{ kind: 'integration', integrationId: 'halopsa', mode: 'read' }],
  surfaces: ['mcp'],
  members: { users: [], groups: [] },
}

function mockDefaults() {
  useTools.mockReturnValue({ data: { tools: [] } })
  useCreateRole.mockReturnValue({ mutate: vi.fn(), isPending: false })
  useUpdateRole.mockReturnValue({ mutate: vi.fn(), isPending: false })
  useUpdateRoleMembers.mockReturnValue({ mutate: vi.fn(), isPending: false })
  useDeleteRole.mockReturnValue({ mutate: vi.fn(), isPending: false })
}

describe('roles page', () => {
  it('builtin edit disables name/id/grants and saves via the members endpoint with a members-only payload', () => {
    mockDefaults()
    useRoles.mockReturnValue({ data: [portalAdmin], isLoading: false, isError: false, refetch: vi.fn() })
    const updateMembersMutate = vi.fn()
    useUpdateRoleMembers.mockReturnValue({ mutate: updateMembersMutate, isPending: false })

    renderPage()

    fireEvent.click(screen.getByText('Portal Admin'))

    expect((screen.getByLabelText('ID') as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByLabelText('Name') as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Add grant' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('Built-in role. Members only.')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(updateMembersMutate).toHaveBeenCalledWith(
      { id: 'portal-admin', members: { users: ['oid-me'], groups: [] } },
      expect.anything(),
    )
  })

  it('non-builtin role saves the full role shape via the full update endpoint', () => {
    mockDefaults()
    useRoles.mockReturnValue({ data: [customRole], isLoading: false, isError: false, refetch: vi.fn() })
    const updateMutate = vi.fn()
    useUpdateRole.mockReturnValue({ mutate: updateMutate, isPending: false })

    renderPage()

    fireEvent.click(screen.getByText('Halo RO'))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(updateMutate).toHaveBeenCalledWith(
      {
        id: 'halo-ro',
        name: 'Halo RO',
        grants: [{ kind: 'integration', integrationId: 'halopsa', mode: 'read' }],
        surfaces: ['mcp'],
        members: { users: [], groups: [] },
      },
      expect.anything(),
    )
  })

  it('removing your own oid from portal-admin members shows a confirm warning before saving', () => {
    mockDefaults()
    useRoles.mockReturnValue({ data: [portalAdmin], isLoading: false, isError: false, refetch: vi.fn() })
    const updateMembersMutate = vi.fn()
    useUpdateRoleMembers.mockReturnValue({ mutate: updateMembersMutate, isPending: false })

    renderPage()

    fireEvent.click(screen.getByText('Portal Admin'))

    // input is empty, Backspace removes the last (only) selected user chip - 'oid-me'
    fireEvent.keyDown(screen.getByLabelText('Users'), { key: 'Backspace' })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(screen.getByText('You are removing your own portal admin access.')).toBeTruthy()
    expect(updateMembersMutate).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    expect(updateMembersMutate).toHaveBeenCalledWith(
      { id: 'portal-admin', members: { users: [], groups: [] } },
      expect.anything(),
    )
  })

  it('removing a group from portal-admin members shows a confirm warning before saving', () => {
    mockDefaults()
    const portalAdminWithGroup: Role = { ...portalAdmin, members: { users: ['oid-me'], groups: ['g1'] } }
    useRoles.mockReturnValue({ data: [portalAdminWithGroup], isLoading: false, isError: false, refetch: vi.fn() })
    const updateMembersMutate = vi.fn()
    useUpdateRoleMembers.mockReturnValue({ mutate: updateMembersMutate, isPending: false })

    renderPage()

    fireEvent.click(screen.getByText('Portal Admin'))

    // input is empty, Backspace removes the last (only) selected group chip - 'g1'
    fireEvent.keyDown(screen.getByLabelText('Groups'), { key: 'Backspace' })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(screen.getByText('Removing a group from portal admin. Make sure another admin keeps access.')).toBeTruthy()
    expect(updateMembersMutate).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    expect(updateMembersMutate).toHaveBeenCalledWith(
      { id: 'portal-admin', members: { users: ['oid-me'], groups: [] } },
      expect.anything(),
    )
  })

  it('blocks a new role with an invalid id and shows the format error', () => {
    mockDefaults()
    useRoles.mockReturnValue({ data: [], isLoading: false, isError: false, refetch: vi.fn() })
    const createMutate = vi.fn()
    useCreateRole.mockReturnValue({ mutate: createMutate, isPending: false })

    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'New role' }))
    fireEvent.change(screen.getByLabelText('ID'), { target: { value: 'Bad Id' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(createMutate).not.toHaveBeenCalled()
    expect(screen.getByText('Lowercase kebab-case, starts with a letter, max 40 characters.')).toBeTruthy()
  })

  it('blocks a save with no surfaces checked and shows the surfaces error', () => {
    mockDefaults()
    useRoles.mockReturnValue({ data: [], isLoading: false, isError: false, refetch: vi.fn() })
    const createMutate = vi.fn()
    useCreateRole.mockReturnValue({ mutate: createMutate, isPending: false })

    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'New role' }))
    fireEvent.change(screen.getByLabelText('ID'), { target: { value: 'halo-ro' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'MCP' })) // default surfaces is ['mcp'], uncheck -> empty
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(createMutate).not.toHaveBeenCalled()
    expect(screen.getByText('Select at least one surface.')).toBeTruthy()
  })
})
