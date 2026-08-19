import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GrantsEditor } from './grants-editor'
import type { Grant } from '../lib/role-queries'

afterEach(() => {
  cleanup()
})

const integrations = ['halopsa', 'ninja']
const toolNames = ['halopsa_get_ticket', 'ninja_get_device']

describe('GrantsEditor', () => {
  it('adding an integration grant emits the default shape', () => {
    const onChange = vi.fn()
    render(<GrantsEditor value={[]} onChange={onChange} integrations={integrations} toolNames={toolNames} />)

    fireEvent.click(screen.getByRole('button', { name: 'Add grant' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Integration' }))

    expect(onChange).toHaveBeenCalledWith([{ kind: 'integration', integrationId: '*', mode: 'read' }])
  })

  it('removing a row emits the array without it', () => {
    const onChange = vi.fn()
    const value: Grant[] = [{ kind: 'wildcard_all' }, { kind: 'integration', integrationId: 'halopsa', mode: 'write' }]
    render(<GrantsEditor value={value} onChange={onChange} integrations={integrations} toolNames={toolNames} />)

    fireEvent.click(screen.getAllByRole('button', { name: 'Remove grant' })[0])

    expect(onChange).toHaveBeenCalledWith([{ kind: 'integration', integrationId: 'halopsa', mode: 'write' }])
  })

  it('wildcard add emits a wildcard_all grant', () => {
    const onChange = vi.fn()
    render(<GrantsEditor value={[]} onChange={onChange} integrations={integrations} toolNames={toolNames} />)

    fireEvent.click(screen.getByRole('button', { name: 'Add grant' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Wildcard (all access)' }))

    expect(onChange).toHaveBeenCalledWith([{ kind: 'wildcard_all' }])
  })

  it('renders and adds a notes_write grant', () => {
    const onChange = vi.fn()
    render(<GrantsEditor value={[{ kind: 'notes_write' }]} onChange={onChange} integrations={[]} toolNames={[]} />)
    expect(screen.getByText('Tool notes: write')).toBeTruthy()
    fireEvent.click(screen.getByText('Add grant'))
    fireEvent.click(screen.getByText('Tool notes (write)'))
    expect(onChange).toHaveBeenCalledWith([{ kind: 'notes_write' }, { kind: 'notes_write' }])
  })
})
