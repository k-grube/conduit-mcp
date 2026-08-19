'use client'

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { Alert, Snackbar as MuiSnackbar, type AlertColor } from '@mui/material'

interface SnackbarContextValue {
  notify(message: string, severity?: AlertColor): void
}

const SnackbarContext = createContext<SnackbarContextValue | undefined>(undefined)

export function useSnackbar(): SnackbarContextValue {
  const ctx = useContext(SnackbarContext)
  if (!ctx) {
    throw new Error('useSnackbar must be used inside SnackbarProvider')
  }
  return ctx
}

interface QueuedMessage {
  key: number
  message: string
  severity: AlertColor
}

let nextKey = 0

// mui "consecutive snackbars" pattern: queue messages, show one at a time, close-then-open
export function SnackbarProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<QueuedMessage[]>([])
  const [current, setCurrent] = useState<QueuedMessage | undefined>(undefined)
  const [open, setOpen] = useState(false)

  const notify = useCallback((message: string, severity: AlertColor = 'error') => {
    setQueue((prev) => [...prev, { key: nextKey++, message, severity }])
  }, [])

  useEffect(() => {
    if (queue.length && !current) {
      setCurrent(queue[0])
      setQueue((prev) => prev.slice(1))
      setOpen(true)
    } else if (queue.length && current && open) {
      setOpen(false)
    }
  }, [queue, current, open])

  function handleClose() {
    setOpen(false)
  }

  function handleExited() {
    setCurrent(undefined)
  }

  return (
    <SnackbarContext.Provider value={{ notify }}>
      {children}
      <MuiSnackbar
        key={current?.key}
        open={open}
        autoHideDuration={5000}
        onClose={handleClose}
        slotProps={{ transition: { onExited: handleExited } }}
      >
        <Alert severity={current?.severity ?? 'error'} onClose={handleClose}>
          {current?.message}
        </Alert>
      </MuiSnackbar>
    </SnackbarContext.Provider>
  )
}
