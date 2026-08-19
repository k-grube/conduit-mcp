import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Page from './page'

afterEach(() => {
  cleanup()
})

const { useTools } = vi.hoisted(() => ({ useTools: vi.fn() }))
vi.mock('../../lib/queries', () => ({ useTools }))

vi.mock('../../components/auth-gate', () => ({
  useAuth: () => ({ account: undefined, logout: vi.fn() }),
}))

const tools = [
  {
    name: 'demo_echo',
    pluginId: 'demo',
    integrationName: 'Demo',
    description: 'echo text back',
    readOnly: false,
    jsonSchema: { type: 'object', properties: { text: { type: 'string' } } },
  },
  {
    name: 'weather_lookup',
    pluginId: 'weather',
    integrationName: 'Weather',
    description: 'look up current weather',
    readOnly: true,
    jsonSchema: { type: 'object', properties: { city: { type: 'string' } } },
  },
]

describe('tools page', () => {
  it('narrows rows via search and expands schema on click', () => {
    useTools.mockReturnValue({ data: { tools }, isLoading: false, isError: false, refetch: vi.fn() })

    render(<Page />)

    expect(screen.getByText('demo_echo')).toBeTruthy()
    expect(screen.getByText('weather_lookup')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'weather' } })

    expect(screen.queryByText('demo_echo')).toBeNull()
    expect(screen.getByText('weather_lookup')).toBeTruthy()

    expect(screen.queryByText(/"city"/)).toBeNull()
    fireEvent.click(screen.getByText('weather_lookup'))
    expect(screen.getByText(/"city"/)).toBeTruthy()
  })

  it('shows loading state while fetching', () => {
    useTools.mockReturnValue({ data: undefined, isLoading: true, isError: false, refetch: vi.fn() })

    render(<Page />)

    expect(screen.getByText('Loading...')).toBeTruthy()
  })

  it('shows error state on query failure and retries on click', () => {
    const refetch = vi.fn()
    useTools.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch })

    render(<Page />)

    expect(screen.getByText('Failed to load')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(refetch).toHaveBeenCalledTimes(1)
  })
})
