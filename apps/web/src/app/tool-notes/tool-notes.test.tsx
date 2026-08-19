import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Page from './page'

afterEach(() => {
  cleanup()
})

const { useToolNotes } = vi.hoisted(() => ({ useToolNotes: vi.fn() }))
vi.mock('../../lib/queries', () => ({ useToolNotes }))

vi.mock('../../components/shell', () => ({
  Shell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

const toolNotesData = {
  tools: {
    halopsa_list_tickets: { text: 'CFClientCode lore', updatedBy: 'user:abc', updatedAt: '2026-08-05T00:00:00.000Z' },
  },
  integrations: {
    halopsa: { text: 'halo-wide lore', updatedBy: 'user:abc', updatedAt: '2026-08-05T00:00:00.000Z' },
  },
}

describe('tool notes page', () => {
  it('lists integration and tool notes with author', () => {
    useToolNotes.mockReturnValue({
      data: toolNotesData,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    })

    render(<Page />)
    expect(screen.getByText('halopsa_list_tickets')).toBeTruthy()
    expect(screen.getByText('CFClientCode lore')).toBeTruthy()
    expect(screen.getByText('halopsa')).toBeTruthy()
    expect(screen.getByText('halo-wide lore')).toBeTruthy()
    expect(screen.getAllByText(/user:abc/).length).toBeGreaterThan(0)
  })

  it('shows loading state while fetching', () => {
    useToolNotes.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: vi.fn(),
    })

    render(<Page />)

    expect(screen.getByText('Loading...')).toBeTruthy()
  })

  it('shows error state on query failure and retries on click', () => {
    const refetch = vi.fn()
    useToolNotes.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch,
    })

    render(<Page />)

    expect(screen.getByText('Failed to load')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('shows no notes saved when data is empty', () => {
    useToolNotes.mockReturnValue({
      data: { tools: {}, integrations: {} },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    })

    render(<Page />)

    expect(screen.getByText('No notes saved')).toBeTruthy()
  })
})
