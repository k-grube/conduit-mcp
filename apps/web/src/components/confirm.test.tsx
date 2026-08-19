import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Confirm } from './confirm'

afterEach(() => {
  cleanup()
})

describe('Confirm', () => {
  it('disables the confirm button while pending and fires onConfirm once on a double click', async () => {
    let resolvePending: () => void = () => {}
    const pending = new Promise<void>((resolve) => {
      resolvePending = resolve
    })
    const onConfirm = vi.fn(() => pending)

    render(<Confirm open title="delete x" message="sure?" onCancel={vi.fn()} onConfirm={onConfirm} />)

    const button = screen.getByRole('button', { name: 'Confirm' })
    fireEvent.click(button)
    fireEvent.click(button)

    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect((button as HTMLButtonElement).disabled).toBe(true)

    resolvePending()
    await pending
  })
})
