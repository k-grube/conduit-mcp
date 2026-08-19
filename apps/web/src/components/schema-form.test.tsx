import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SchemaForm } from './schema-form'
import type { SettingsField } from '../lib/plugin-queries'

afterEach(() => {
  cleanup()
})

const fields: SettingsField[] = [
  { key: 'baseUrl', label: 'Base URL', type: 'text', required: true, help: 'the api base url' },
  { key: 'API_TOKEN', label: 'API Token', type: 'secret' },
  { key: 'OTHER_TOKEN', label: 'Other Token', type: 'secret' },
  { key: 'enabled', label: 'Enabled', type: 'toggle' },
  {
    key: 'region',
    label: 'Region',
    type: 'select',
    options: [
      { value: 'us', label: 'US' },
      { value: 'eu', label: 'EU' },
    ],
  },
  { key: 'teams', label: 'Teams', type: 'tags' },
]

const secretStatus = [
  { name: 'API_TOKEN', set: true },
  { name: 'OTHER_TOKEN', set: false },
]

describe('SchemaForm', () => {
  it('renders all four field types from a fixture', () => {
    render(
      <SchemaForm
        fields={fields}
        values={{ baseUrl: 'https://example.com', region: 'eu' }}
        secretStatus={secretStatus}
        onSave={vi.fn().mockResolvedValue(true)}
      />,
    )

    expect((screen.getByLabelText('Base URL', { exact: false }) as HTMLInputElement).value).toBe('https://example.com')
    expect((screen.getByLabelText('API Token') as HTMLInputElement).value).toBe('********')
    expect(screen.getByTestId('CheckCircleIcon')).toBeTruthy()
    expect(screen.getByPlaceholderText('Not set')).toBeTruthy()
    expect(screen.getByRole('switch', { name: 'Enabled' })).toBeTruthy()
    expect(screen.getByLabelText('Region')).toBeTruthy()
  })

  it('suppresses browser autofill on text and secret inputs', () => {
    render(<SchemaForm fields={fields} values={{}} secretStatus={secretStatus} onSave={vi.fn()} />)

    expect(screen.getByLabelText('Base URL', { exact: false }).getAttribute('autocomplete')).toBe('off')
    expect(screen.getByLabelText('API Token').getAttribute('autocomplete')).toBe('new-password')
    expect(screen.getByLabelText('Other Token').getAttribute('autocomplete')).toBe('new-password')
  })

  it('masks a set secret until focused, restores the mask when left untouched', () => {
    render(<SchemaForm fields={fields} values={{}} secretStatus={secretStatus} onSave={vi.fn()} />)

    const input = screen.getByLabelText('API Token') as HTMLInputElement
    expect(input.value).toBe('********')

    fireEvent.focus(input)
    expect(input.value).toBe('')

    fireEvent.blur(input)
    expect(input.value).toBe('********')
  })

  it('never submits the mask, a pristine set secret stays out of secretValues', () => {
    const onSave = vi.fn().mockResolvedValue(true)
    render(
      <SchemaForm
        fields={fields}
        values={{ baseUrl: 'https://example.com' }}
        secretStatus={secretStatus}
        onSave={onSave}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave.mock.calls[0][0].secretValues).toEqual({})
  })

  it('typed secret lands in secretValues while an untouched secret is absent', () => {
    const onSave = vi.fn().mockResolvedValue(true)
    render(
      <SchemaForm
        fields={fields}
        values={{ baseUrl: 'https://example.com' }}
        secretStatus={secretStatus}
        onSave={onSave}
      />,
    )

    fireEvent.change(screen.getByLabelText('API Token'), { target: { value: 'new-token' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(onSave).toHaveBeenCalledTimes(1)
    const result = onSave.mock.calls[0][0]
    expect(result.secretValues).toEqual({ API_TOKEN: 'new-token' })
  })

  it('renders existing tags as chips', () => {
    render(
      <SchemaForm
        fields={fields}
        values={{ teams: ['Tier 1', 'Tier 2'] }}
        secretStatus={secretStatus}
        onSave={vi.fn()}
      />,
    )

    expect(screen.getByText('Tier 1')).toBeTruthy()
    expect(screen.getByText('Tier 2')).toBeTruthy()
  })

  it('blank required text field blocks submit with a validation error', () => {
    const onSave = vi.fn()
    render(<SchemaForm fields={fields} values={{}} secretStatus={secretStatus} onSave={onSave} />)

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByText('Base URL is required')).toBeTruthy()
  })

  it('adds a chip on enter and saves the field as a string array', () => {
    const onSave = vi.fn().mockResolvedValue(true)
    render(
      <SchemaForm
        fields={fields}
        values={{ baseUrl: 'https://example.com', teams: ['Tier 1'] }}
        secretStatus={secretStatus}
        onSave={onSave}
      />,
    )

    const input = screen.getByLabelText('Teams')
    fireEvent.change(input, { target: { value: 'Tier 2' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(onSave.mock.calls[0][0].config.teams).toEqual(['Tier 1', 'Tier 2'])
  })

  it('removes a chip via its delete icon', () => {
    const onSave = vi.fn().mockResolvedValue(true)
    render(
      <SchemaForm
        fields={fields}
        values={{ baseUrl: 'https://example.com', teams: ['Tier 1'] }}
        secretStatus={secretStatus}
        onSave={onSave}
      />,
    )

    fireEvent.click(screen.getByTestId('CancelIcon'))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(onSave.mock.calls[0][0].config.teams).toEqual([])
  })

  it('trims entries and drops duplicates', () => {
    const onSave = vi.fn().mockResolvedValue(true)
    render(
      <SchemaForm
        fields={fields}
        values={{ baseUrl: 'https://example.com', teams: ['Tier 1'] }}
        secretStatus={secretStatus}
        onSave={onSave}
      />,
    )

    const input = screen.getByLabelText('Teams')
    fireEvent.change(input, { target: { value: '  Tier 1  ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(onSave.mock.calls[0][0].config.teams).toEqual(['Tier 1'])
  })

  it('splits a comma-string value saved before the field became tags', () => {
    render(
      <SchemaForm
        fields={fields}
        values={{ teams: 'Tier 1, Projects' }}
        secretStatus={secretStatus}
        onSave={vi.fn()}
      />,
    )

    expect(screen.getByText('Tier 1')).toBeTruthy()
    expect(screen.getByText('Projects')).toBeTruthy()
  })

  it('required tags field with no chips blocks submit with a validation error', () => {
    const onSave = vi.fn()
    render(
      <SchemaForm
        fields={[{ key: 'teams', label: 'Teams', type: 'tags', required: true }]}
        values={{}}
        secretStatus={[]}
        onSave={onSave}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByText('Teams is required')).toBeTruthy()
  })

  it('clears a typed secret after a successful save, so a follow-up save sends no secret values', async () => {
    const onSave = vi.fn().mockResolvedValue(true)
    render(
      <SchemaForm
        fields={fields}
        values={{ baseUrl: 'https://example.com' }}
        secretStatus={secretStatus}
        onSave={onSave}
      />,
    )

    fireEvent.change(screen.getByLabelText('Other Token'), { target: { value: 'newly-typed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave.mock.calls[0][0].secretValues).toEqual({ OTHER_TOKEN: 'newly-typed' })

    await waitFor(() => {
      expect((screen.getByLabelText('Other Token') as HTMLInputElement).value).toBe('')
    })

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2))
    expect(onSave.mock.calls[1][0].secretValues).toEqual({})
  })

  it('does not clear a typed secret when the save fails, so it stays available for retry', async () => {
    const onSave = vi.fn().mockResolvedValue(false)
    render(
      <SchemaForm
        fields={fields}
        values={{ baseUrl: 'https://example.com' }}
        secretStatus={secretStatus}
        onSave={onSave}
      />,
    )

    fireEvent.change(screen.getByLabelText('Other Token'), { target: { value: 'newly-typed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect((screen.getByLabelText('Other Token') as HTMLInputElement).value).toBe('newly-typed')
  })

  it('reflects a refetched set status once the secret input is cleared after save', async () => {
    const onSave = vi.fn().mockResolvedValue(true)
    const { rerender } = render(
      <SchemaForm
        fields={fields}
        values={{ baseUrl: 'https://example.com' }}
        secretStatus={secretStatus}
        onSave={onSave}
      />,
    )

    expect(screen.getByLabelText('Other Token').getAttribute('placeholder')).toBe('Not set')

    fireEvent.change(screen.getByLabelText('Other Token'), { target: { value: 'newly-typed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect((screen.getByLabelText('Other Token') as HTMLInputElement).value).toBe('')
    })

    // the settings page refetches secret status after a successful save and passes the fresh prop down
    rerender(
      <SchemaForm
        fields={fields}
        values={{ baseUrl: 'https://example.com' }}
        secretStatus={[
          { name: 'API_TOKEN', set: true },
          { name: 'OTHER_TOKEN', set: true },
        ]}
        onSave={onSave}
      />,
    )

    expect((screen.getByLabelText('Other Token') as HTMLInputElement).value).toBe('********')
  })
})
