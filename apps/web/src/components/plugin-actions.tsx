'use client'

import { useState } from 'react'
import { Box, Button, Collapse, Stack } from '@mui/material'
import { api } from '../lib/api'
import { pluginErrorMessage, type UiAction } from '../lib/plugin-queries'
import { useSnackbar } from './snackbar'

interface PluginActionsProps {
  actions: UiAction[]
  pluginId: string
}

export function PluginActions({ actions, pluginId }: PluginActionsProps) {
  const { notify } = useSnackbar()
  const [results, setResults] = useState<Record<string, unknown>>({})
  const [pendingId, setPendingId] = useState<string | undefined>(undefined)

  async function run(action: UiAction) {
    setPendingId(action.id)
    try {
      const res = await api.request({ method: action.method, url: `/api/plugins/${pluginId}${action.route}` })
      setResults((prev) => ({ ...prev, [action.id]: res.data }))
    } catch (err) {
      notify(pluginErrorMessage(err, `${action.label} failed.`))
    } finally {
      setPendingId(undefined)
    }
  }

  if (actions.length === 0) {
    return null
  }

  return (
    <Stack spacing={2} sx={{ alignItems: 'flex-start' }}>
      {actions.map((action) => (
        <Box key={action.id}>
          <Button variant="outlined" onClick={() => run(action)} disabled={pendingId === action.id}>
            {action.label}
          </Button>
          <Collapse in={action.id in results}>
            <Box component="pre" sx={{ m: 0, mt: 1, fontSize: 12, overflow: 'auto' }}>
              {JSON.stringify(results[action.id], null, 2)}
            </Box>
          </Collapse>
        </Box>
      ))}
    </Stack>
  )
}
