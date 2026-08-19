'use client'

import { useCallback, useEffect, useState } from 'react'
import { Box, CircularProgress, Stack, Typography } from '@mui/material'
import { SetupAutomatedCard } from './setup-automated-card'
import { SetupManualCard } from './setup-manual-card'
import { setupTokenHeaders } from '../lib/setup-token'

export type SetupStepId = 'app' | 'manifest' | 'sp' | 'consent' | 'secret' | 'store' | 'admin' | 'config'

export interface SetupStepState {
  id: SetupStepId
  state: 'pending' | 'active' | 'done' | 'error'
  detail?: string
}

export interface SetupResult {
  tenantId: string
  clientId: string
  consentGranted: boolean
  consentCommand?: string
  secretStored: 'keyvault' | 'shown'
  clientSecret?: string
}

export interface SetupSessionStatus {
  authenticated: boolean
  user?: { name?: string; upn?: string }
  provisioning: boolean
  steps: SetupStepState[]
  result?: SetupResult
  error?: string
}

export interface SetupStatusPayload {
  configured: boolean
  serverUrl?: string
  oidLockActive: boolean
  secretsWritable: boolean
  session?: SetupSessionStatus
}

const STATUS_POLL_MS = 5000

export function SetupWizard() {
  const [status, setStatus] = useState<SetupStatusPayload | undefined>(undefined)

  const refresh = useCallback(() => {
    fetch('/api/setup/status', { headers: setupTokenHeaders() })
      .then((res) => res.json())
      .then(setStatus)
      .catch(() => {})
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    if (!status?.session?.provisioning) {
      return
    }
    const id = setInterval(refresh, STATUS_POLL_MS)
    return () => clearInterval(id)
  }, [status?.session?.provisioning, refresh])

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', p: 2 }}>
      <Stack spacing={2} sx={{ maxWidth: 960, width: '100%', alignItems: 'center' }}>
        <Typography variant="h6">Set up authentication</Typography>
        {!status ? (
          <CircularProgress size={20} />
        ) : (
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ width: '100%', alignItems: 'stretch' }}>
            <SetupAutomatedCard status={status} onChanged={refresh} />
            <SetupManualCard status={status} onChanged={refresh} />
          </Stack>
        )}
      </Stack>
    </Box>
  )
}
