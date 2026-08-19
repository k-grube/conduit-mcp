'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Link,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import ErrorIcon from '@mui/icons-material/Error'
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked'
import type { SetupStatusPayload, SetupStepId, SetupStepState } from './setup-wizard'
import { rememberSetupToken, setupTokenHeaders } from '../lib/setup-token'

interface SetupAutomatedCardProps {
  status: SetupStatusPayload
  onChanged(): void
}

const STEP_LABELS: Record<SetupStepId, string> = {
  app: 'Find or create app registration',
  manifest: 'Apply manifest (redirects, scopes, claims)',
  sp: 'Ensure service principal',
  consent: 'Grant admin consent',
  secret: 'Create client secret',
  store: 'Store client secret',
  admin: 'Seed admin role',
  config: 'Write auth config',
}

const STEP_STATE_LABELS: Record<SetupStepState['state'], string> = {
  pending: 'Pending',
  active: 'Active',
  done: 'Done',
  error: 'Error',
}

const POLL_INTERVAL_MS = 5000

interface DeviceCodeInfo {
  userCode: string
  verificationUri: string
}

type Phase = 'idle' | 'code' | 'authenticated' | 'provisioning' | 'done' | 'error'

function derivePhase(session: SetupStatusPayload['session'], deviceCode: DeviceCodeInfo | undefined): Phase {
  if (!session?.authenticated) {
    return deviceCode ? 'code' : 'idle'
  }
  if (session.error) {
    return 'error'
  }
  if (session.provisioning) {
    return 'provisioning'
  }
  if (session.result) {
    return 'done'
  }
  return 'authenticated'
}

function stepIcon(state: SetupStepState['state']) {
  if (state === 'done') {
    return <CheckCircleIcon color="success" fontSize="small" />
  }
  if (state === 'active') {
    return <CircularProgress size={16} />
  }
  if (state === 'error') {
    return <ErrorIcon color="error" fontSize="small" />
  }
  return <RadioButtonUncheckedIcon color="disabled" fontSize="small" />
}

export function SetupAutomatedCard({ status, onChanged }: SetupAutomatedCardProps) {
  const [displayName, setDisplayName] = useState('conduit-mcp')
  const [deviceCode, setDeviceCode] = useState<DeviceCodeInfo | undefined>(undefined)
  const [cardError, setCardError] = useState<string | undefined>(undefined)
  const [provisionError, setProvisionError] = useState<string | undefined>(undefined)
  const [starting, setStarting] = useState(false)
  const provisionFired = useRef(false)

  const session = status.session
  const phase = derivePhase(session, deviceCode)

  async function startDeviceCode() {
    setStarting(true)
    setCardError(undefined)
    try {
      const res = await fetch('/api/setup/device-code', { method: 'POST' })
      const body = await res.json()
      if (!res.ok) {
        setCardError(body.error ?? 'Failed to start device code sign-in.')
        return
      }
      rememberSetupToken(body.setupToken)
      setDeviceCode({ userCode: body.userCode, verificationUri: body.verificationUri })
    } finally {
      setStarting(false)
    }
  }

  function fireProvision() {
    setProvisionError(undefined)
    fetch('/api/setup/provision', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...setupTokenHeaders() },
      body: JSON.stringify({ displayName }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json()
          setProvisionError(body.error ?? 'Failed to start provisioning.')
          return
        }
        onChanged()
      })
      .catch(() => {})
  }

  useEffect(() => {
    if (phase !== 'code') {
      return
    }
    const id = setInterval(async () => {
      const res = await fetch('/api/setup/poll', { method: 'POST', headers: setupTokenHeaders() })
      // server restart wipes the in-memory setup session, poll then 401s
      if (res.status === 401) {
        setDeviceCode(undefined)
        setCardError('Setup session lost. Start again.')
        return
      }
      if (res.status === 403) {
        setDeviceCode(undefined)
        setCardError('Signed-in account does not match BOOTSTRAP_ADMIN_OID.')
        return
      }
      if (res.status === 410) {
        setDeviceCode(undefined)
        setCardError('Code expired.')
        return
      }
      // other failures are transient, keep polling instead of refetching status off an error body
      if (!res.ok) {
        return
      }
      const body = await res.json()
      if (!body.pending) {
        onChanged()
      }
    }, POLL_INTERVAL_MS)
    return () => clearInterval(id)
  }, [phase, onChanged])

  useEffect(() => {
    if (phase !== 'authenticated' || provisionFired.current) {
      return
    }
    provisionFired.current = true
    fireProvision()
    // fires once per authenticated transition, displayName is read fresh via fireProvision's closure
  }, [phase])

  useEffect(() => {
    if (phase !== 'done') {
      return
    }
    // happy path flips itself, pause only when the operator must copy the consent command or dev secret
    const result = session?.result
    if (result?.consentGranted === false || result?.secretStored === 'shown') {
      return
    }
    const id = setTimeout(() => window.location.reload(), 1000)
    return () => clearTimeout(id)
  }, [phase, session])

  if (phase === 'idle') {
    return (
      <Card sx={{ flex: 1, maxWidth: 480 }}>
        <CardContent>
          <Stack spacing={2}>
            <Typography variant="subtitle1">Automated setup</Typography>
            {cardError && <Typography color="error">{cardError}</Typography>}
            <TextField
              label="Display name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              size="small"
            />
            <Button variant="contained" onClick={startDeviceCode} disabled={starting}>
              Start
            </Button>
          </Stack>
        </CardContent>
      </Card>
    )
  }

  if (phase === 'code' && deviceCode) {
    return (
      <Card sx={{ flex: 1, maxWidth: 480 }}>
        <CardContent>
          <Stack spacing={2} sx={{ alignItems: 'center', textAlign: 'center' }}>
            <Typography variant="h4">{deviceCode.userCode}</Typography>
            <Link href={deviceCode.verificationUri} target="_blank" rel="noreferrer">
              {deviceCode.verificationUri}
            </Link>
            <Typography variant="body2">Waiting for sign-in</Typography>
            <CircularProgress size={20} />
          </Stack>
        </CardContent>
      </Card>
    )
  }

  if (phase === 'authenticated') {
    return (
      <Card sx={{ flex: 1, maxWidth: 480 }}>
        <CardContent>
          <Stack spacing={2} sx={{ alignItems: 'center' }}>
            <Typography variant="body2">Signed in as {session?.user?.name ?? session?.user?.upn}</Typography>
            {provisionError ? (
              <>
                <Typography color="error">{provisionError}</Typography>
                <Button
                  variant="outlined"
                  onClick={() => {
                    provisionFired.current = false
                    fireProvision()
                  }}
                >
                  Retry
                </Button>
              </>
            ) : (
              <CircularProgress size={20} />
            )}
          </Stack>
        </CardContent>
      </Card>
    )
  }

  if (phase === 'provisioning') {
    return (
      <Card sx={{ flex: 1, maxWidth: 480 }}>
        <CardContent>
          <List dense>
            {session?.steps.map((step) => (
              <ListItem key={step.id}>
                <ListItemIcon>{stepIcon(step.state)}</ListItemIcon>
                <ListItemText primary={STEP_LABELS[step.id]} secondary={STEP_STATE_LABELS[step.state]} />
              </ListItem>
            ))}
          </List>
        </CardContent>
      </Card>
    )
  }

  if (phase === 'error') {
    const failing = session?.steps.find((s) => s.state === 'error')
    return (
      <Card sx={{ flex: 1, maxWidth: 480 }}>
        <CardContent>
          <Stack spacing={2}>
            <Typography color="error">{failing?.detail ?? session?.error}</Typography>
            <Button
              variant="outlined"
              onClick={() => {
                provisionFired.current = false
                fireProvision()
              }}
            >
              Retry
            </Button>
          </Stack>
        </CardContent>
      </Card>
    )
  }

  const result = session?.result
  return (
    <Card sx={{ flex: 1, maxWidth: 480 }}>
      <CardContent>
        <Stack spacing={2}>
          <Typography variant="subtitle1">Setup complete</Typography>
          {result?.consentGranted === false && (
            <Stack spacing={1}>
              <Typography variant="body2">Admin consent still required.</Typography>
              <Box component="code" sx={{ display: 'block', p: 1, bgcolor: 'action.hover' }}>
                {result.consentCommand}
              </Box>
            </Stack>
          )}
          {result?.secretStored === 'shown' && (
            <Stack spacing={1}>
              <Typography variant="body2">
                Copy this into .dev.env as AZURE_CLIENT_SECRET. It will not be shown again.
              </Typography>
              <Box component="code" sx={{ display: 'block', p: 1, bgcolor: 'action.hover' }}>
                {result.clientSecret}
              </Box>
            </Stack>
          )}
          <Button variant="contained" onClick={() => window.location.reload()}>
            Continue
          </Button>
        </Stack>
      </CardContent>
    </Card>
  )
}
