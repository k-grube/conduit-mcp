'use client'

import { useEffect, useState } from 'react'
import { Alert, Box, Button, Card, CardContent, Chip, Stack, TextField, Typography } from '@mui/material'
import { Confirm } from '../../components/confirm'
import { ErrorState } from '../../components/error-state'
import { Shell } from '../../components/shell'
import { useSnackbar } from '../../components/snackbar'
import { configErrorMessage, isConflict, useConfigDomain, useUpdateConfigDomain } from '../../lib/config-queries'
import { useRestart, useUpdateStatus } from '../../lib/system-queries'

export default function Page() {
  return (
    <Shell>
      <Stack spacing={2}>
        <AuthCard />
        <RetentionCard />
        <UpdateCard />
      </Stack>
    </Shell>
  )
}

function shortSha(sha?: string) {
  return sha ? sha.slice(0, 7) : 'unknown'
}

function UpdateCard() {
  const { data, isLoading, isError, refetch, isFetching } = useUpdateStatus({ live: true })
  const restartMutation = useRestart()
  const { notify } = useSnackbar()
  const [confirmOpen, setConfirmOpen] = useState(false)

  function handleRestart() {
    setConfirmOpen(false)
    restartMutation.mutate(undefined, {
      onSuccess: () => {
        notify('Restart initiated. The portal will be unavailable for a few minutes.', 'success')
      },
      onError: () => {
        notify('Restart failed. Restart from the Azure portal instead.', 'error')
      },
    })
  }

  return (
    <Card>
      <CardContent>
        <Typography variant="h6">Updates</Typography>
        {isError && <ErrorState onRetry={() => refetch()} />}
        {isLoading && <Typography variant="body2">Loading...</Typography>}
        {!isLoading && !isError && data && (
          <Stack spacing={2} sx={{ pt: 1, alignItems: 'flex-start' }}>
            {data.unavailable ? (
              <Alert severity="info">Update check unavailable: {data.unavailable}</Alert>
            ) : (
              <>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  {data.updateAvailable ? (
                    <Chip size="small" color="warning" label="Update available" />
                  ) : (
                    <Chip size="small" color="success" label="Up to date" />
                  )}
                  <Typography variant="body2" color="text.secondary">
                    Running {shortSha(data.runningSha)}, registry has {shortSha(data.remoteSha)} ({data.tag})
                  </Typography>
                </Stack>
                {data.updateAvailable && (
                  <Alert severity="info">
                    Restarting pulls the current {data.tag} image. Instances pinned to a specific build tag restart
                    without changing versions.
                  </Alert>
                )}
              </>
            )}
            <Stack direction="row" spacing={1}>
              <Button onClick={() => refetch()} disabled={isFetching}>
                Check again
              </Button>
              <Button
                variant="contained"
                color="warning"
                onClick={() => setConfirmOpen(true)}
                disabled={restartMutation.isPending}
              >
                Restart server
              </Button>
            </Stack>
          </Stack>
        )}
        <Confirm
          open={confirmOpen}
          title="Restart the server?"
          message="All live MCP sessions drop and the portal goes down until the container is back, usually a couple of minutes."
          onCancel={() => setConfirmOpen(false)}
          onConfirm={handleRestart}
        />
      </CardContent>
    </Card>
  )
}

interface AuthDomain {
  tenantId?: string
  clientId?: string
  serverUrl?: string
  redirectHosts?: string[]
}

function AuthCard() {
  const { data, isLoading, isError, refetch } = useConfigDomain<AuthDomain>('auth')
  const updateMutation = useUpdateConfigDomain<AuthDomain>('auth')
  const { notify } = useSnackbar()

  const [tenantId, setTenantId] = useState('')
  const [clientId, setClientId] = useState('')
  const [serverUrl, setServerUrl] = useState('')
  const [redirectHosts, setRedirectHosts] = useState<string[]>([])
  const [hostInput, setHostInput] = useState('')
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [serverUrlError, setServerUrlError] = useState<string | undefined>(undefined)
  const [redirectHostsError, setRedirectHostsError] = useState<string | undefined>(undefined)
  const [hostInputError, setHostInputError] = useState<string | undefined>(undefined)
  // touched flag separate from `dirty`, so clearing all chips still sends `redirectHosts: []` not omitted
  const [redirectHostsDirty, setRedirectHostsDirty] = useState(false)

  useEffect(() => {
    if (data && !dirty) {
      setTenantId(data.tenantId ?? '')
      setClientId(data.clientId ?? '')
      setServerUrl(data.serverUrl ?? '')
      setRedirectHosts(data.redirectHosts ?? [])
      setRedirectHostsDirty(false)
    }
  }, [data, dirty])

  function markDirty() {
    setDirty(true)
  }

  function addHost() {
    const host = hostInput.trim()
    if (!host) {
      return
    }
    // matches the server's redirectHostSchema rule, single-label entries widen the allowlist by suffix match
    if (host !== 'localhost' && !host.includes('.')) {
      setHostInputError('Must be fully qualified or "localhost".')
      return
    }
    setHostInputError(undefined)
    if (!redirectHosts.includes(host)) {
      setRedirectHosts((prev) => [...prev, host])
      setRedirectHostsDirty(true)
      markDirty()
    }
    setHostInput('')
  }

  function removeHost(host: string) {
    setRedirectHosts((prev) => prev.filter((h) => h !== host))
    setRedirectHostsDirty(true)
    markDirty()
  }

  function handleSave() {
    setError(undefined)
    setServerUrlError(undefined)
    setRedirectHostsError(undefined)
    // empty tenantId/clientId/serverUrl means "leave as is", redirectHosts sends `[]` when touched to allow clearing
    const patch: Record<string, unknown> = {}
    if (tenantId.trim()) {
      patch.tenantId = tenantId.trim()
    }
    if (clientId.trim()) {
      patch.clientId = clientId.trim()
    }
    if (serverUrl.trim()) {
      patch.serverUrl = serverUrl.trim()
    }
    if (redirectHostsDirty) {
      patch.redirectHosts = redirectHosts
    }
    updateMutation.mutate(patch, {
      onSuccess: () => {
        setDirty(false)
        setRedirectHostsDirty(false)
        notify('Settings saved.', 'success')
      },
      onError: (err) => {
        if (isConflict(err)) {
          notify('Config changed elsewhere, reloading.')
          refetch()
          return
        }
        const message = configErrorMessage(err, 'failed to save')
        if (message.includes('serverUrl')) {
          setServerUrlError(message)
        } else if (message.includes('redirectHosts')) {
          setRedirectHostsError(message)
        } else {
          setError(message)
        }
      },
    })
  }

  return (
    <Card>
      <CardContent>
        <Typography variant="h6">Auth</Typography>
        {isError && <ErrorState onRetry={() => refetch()} />}
        {isLoading && <Typography variant="body2">Loading...</Typography>}
        {!isLoading && !isError && (
          <Stack spacing={2} sx={{ pt: 1, alignItems: 'flex-start' }}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField
              label="Tenant ID"
              value={tenantId}
              onChange={(e) => {
                setTenantId(e.target.value)
                markDirty()
              }}
              size="small"
              sx={{ minWidth: 320 }}
            />
            <TextField
              label="Client ID"
              value={clientId}
              onChange={(e) => {
                setClientId(e.target.value)
                markDirty()
              }}
              size="small"
              sx={{ minWidth: 320 }}
            />
            <TextField
              label="Server URL"
              value={serverUrl}
              onChange={(e) => {
                setServerUrl(e.target.value)
                markDirty()
              }}
              error={Boolean(serverUrlError)}
              helperText={serverUrlError ?? 'HTTPS required (or HTTP on localhost), no query string or fragment.'}
              size="small"
              sx={{ minWidth: 320 }}
            />
            <Stack spacing={1} sx={{ width: '100%' }}>
              <Typography variant="body2">Redirect hosts</Typography>
              <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
                {redirectHosts.map((host) => (
                  <Chip key={host} size="small" label={host} onDelete={() => removeHost(host)} />
                ))}
              </Stack>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
                <TextField
                  label="Add redirect host"
                  value={hostInput}
                  onChange={(e) => {
                    setHostInput(e.target.value)
                    setHostInputError(undefined)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      addHost()
                    }
                  }}
                  error={Boolean(hostInputError)}
                  helperText={hostInputError}
                  size="small"
                />
                <Button onClick={addHost}>Add</Button>
              </Stack>
              {redirectHostsError && (
                <Typography variant="caption" color="error">
                  {redirectHostsError}
                </Typography>
              )}
            </Stack>
            <Alert severity="warning">Saving auth config reloads auth and drops live MCP sessions.</Alert>
            <Box>
              <Button variant="contained" onClick={handleSave} disabled={!dirty || updateMutation.isPending}>
                Save
              </Button>
            </Box>
          </Stack>
        )}
      </CardContent>
    </Card>
  )
}

interface RetentionDomain {
  usageDays?: number
  sessionDays?: number
  eventDays?: number
  dcrDays?: number
}

const RETENTION_FIELDS: { key: keyof RetentionDomain; label: string; defaultDays: number }[] = [
  { key: 'usageDays', label: 'Usage logs (days)', defaultDays: 90 },
  { key: 'sessionDays', label: 'Sessions (days)', defaultDays: 2 },
  { key: 'eventDays', label: 'Session events (days)', defaultDays: 2 },
  { key: 'dcrDays', label: 'DCR clients (days)', defaultDays: 90 },
]

function RetentionCard() {
  const { data, isLoading, isError, refetch } = useConfigDomain<RetentionDomain>('retention')
  const updateMutation = useUpdateConfigDomain<RetentionDomain>('retention')
  const { notify } = useSnackbar()

  const [values, setValues] = useState<Record<string, string>>({})
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    if (data && !dirty) {
      const next: Record<string, string> = {}
      for (const field of RETENTION_FIELDS) {
        const v = data[field.key]
        // prefill the runtime default rather than leaving blank, a blank field blocks save
        next[field.key] = typeof v === 'number' ? String(v) : String(field.defaultDays)
      }
      setValues(next)
    }
  }, [data, dirty])

  function setField(key: string, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }))
    setDirty(true)
  }

  function handleSave() {
    setError(undefined)
    const nextFieldErrors: Record<string, string> = {}
    const patch: Record<string, number> = {}
    for (const field of RETENTION_FIELDS) {
      const raw = (values[field.key] ?? '').trim()
      if (raw === '') {
        // deep-merge PUT never deletes a key, a blank save would silently no-op, block it instead
        nextFieldErrors[field.key] = 'Enter a value.'
        continue
      }
      const n = Number(raw)
      if (!Number.isInteger(n) || n < 1 || n > 3650) {
        nextFieldErrors[field.key] = 'Whole number between 1 and 3650.'
        continue
      }
      patch[field.key] = n
    }
    setFieldErrors(nextFieldErrors)
    if (Object.keys(nextFieldErrors).length > 0) {
      return
    }
    updateMutation.mutate(patch, {
      onSuccess: () => {
        setDirty(false)
        notify('Settings saved.', 'success')
      },
      onError: (err) => {
        if (isConflict(err)) {
          notify('Config changed elsewhere, reloading.')
          refetch()
          return
        }
        setError(configErrorMessage(err, 'Failed to save.'))
      },
    })
  }

  return (
    <Card>
      <CardContent>
        <Typography variant="h6">Retention</Typography>
        {isError && <ErrorState onRetry={() => refetch()} />}
        {isLoading && <Typography variant="body2">Loading...</Typography>}
        {!isLoading && !isError && (
          <Stack spacing={2} sx={{ pt: 1, alignItems: 'flex-start' }}>
            {error && <Alert severity="error">{error}</Alert>}
            {RETENTION_FIELDS.map((field) => (
              <TextField
                key={field.key}
                label={field.label}
                type="number"
                value={values[field.key] ?? ''}
                onChange={(e) => setField(field.key, e.target.value)}
                error={Boolean(fieldErrors[field.key])}
                helperText={fieldErrors[field.key] ?? `Defaults to ${field.defaultDays} if unset, clamped 1-3650.`}
                size="small"
                sx={{ minWidth: 260 }}
              />
            ))}
            <Box>
              <Button variant="contained" onClick={handleSave} disabled={!dirty || updateMutation.isPending}>
                Save
              </Button>
            </Box>
          </Stack>
        )}
      </CardContent>
    </Card>
  )
}
