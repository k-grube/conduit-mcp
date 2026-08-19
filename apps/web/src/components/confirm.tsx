'use client'

import { useState } from 'react'
import { Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle } from '@mui/material'

interface ConfirmProps {
  open: boolean
  title: string
  message: string
  onCancel: () => void
  onConfirm: () => void | Promise<void>
}

export function Confirm({ open, title, message, onCancel, onConfirm }: ConfirmProps) {
  const [pending, setPending] = useState(false)

  async function handleConfirm() {
    if (pending) {
      return
    }
    setPending(true)
    try {
      await onConfirm()
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onClose={pending ? undefined : onCancel}>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <DialogContentText>{message}</DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button onClick={handleConfirm} color="error" disabled={pending}>
          Confirm
        </Button>
      </DialogActions>
    </Dialog>
  )
}
