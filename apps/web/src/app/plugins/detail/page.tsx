'use client'

import { Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Box, Button, Card, CardContent, Chip, FormControlLabel, Stack, Switch, Typography } from '@mui/material'
import { ErrorState } from '../../../components/error-state'
import { Shell } from '../../../components/shell'
import { useSnackbar } from '../../../components/snackbar'
import {
  pluginErrorMessage,
  useDisablePlugin,
  useEnablePlugin,
  usePlugin,
  usePluginHealth,
  usePlugins,
} from '../../../lib/plugin-queries'
import { STATUS_COLOR, STATUS_LABEL } from '../../../lib/plugin-status'

function PluginDetail({ id }: { id: string }) {
  const { data, isLoading, isError, refetch } = usePlugin(id)
  const { data: plugins } = usePlugins()
  const health = usePluginHealth(id)
  const enableMutation = useEnablePlugin()
  const disableMutation = useDisablePlugin()
  const { notify } = useSnackbar()

  function toggleEnabled(enabled: boolean) {
    const mutation = enabled ? enableMutation : disableMutation
    mutation.mutate(id, {
      onError: (err) => notify(pluginErrorMessage(err, 'Failed to update plugin.')),
    })
  }

  if (isError) {
    return <ErrorState onRetry={() => refetch()} />
  }
  if (isLoading || !data) {
    return <Typography variant="body2">Loading...</Typography>
  }

  const { record, manifest, displayStatus } = data
  const toolCount = plugins?.find((p) => p.id === id)?.toolCount

  return (
    <Stack spacing={2}>
      <Typography variant="h5">{record.id}</Typography>

      <Card>
        <CardContent>
          <Typography variant="overline">Record</Typography>
          <Stack spacing={1} sx={{ mt: 1 }}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <Chip size="small" label={STATUS_LABEL[displayStatus]} color={STATUS_COLOR[displayStatus]} />
              <FormControlLabel
                control={<Switch checked={record.enabled} onChange={(e) => toggleEnabled(e.target.checked)} />}
                label="Enabled"
              />
            </Stack>
            <Typography variant="body2">Source: {record.source}</Typography>
            {record.source === 'git' && <Typography variant="body2">Ref: {record.ref ?? '-'}</Typography>}
            {record.source === 'git' && <Typography variant="body2">Commit: {record.commit ?? '-'}</Typography>}
            {record.source === 'local' && <Typography variant="body2">Path: {record.localPath}</Typography>}
            <Typography variant="body2">Loaded: {record.loadedAt ?? '-'}</Typography>
            {record.health && (
              <Typography variant="body2" color={record.health.ok ? 'text.secondary' : 'error'}>
                Health: {record.health.ok ? 'ok' : (record.health.detail ?? 'failing')} ({record.health.checkedAt})
              </Typography>
            )}
            {record.lastError && (
              <Typography variant="body2" color="error">
                Last error: {record.lastError}
              </Typography>
            )}
          </Stack>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="overline">Manifest</Typography>
          {manifest ? (
            <Stack spacing={1} sx={{ mt: 1 }}>
              <Typography variant="body2">Tool prefix: {manifest.toolPrefix}</Typography>
              <Typography variant="body2">SDK version: {manifest.sdkVersion}</Typography>
              <Typography variant="body2">Tools: {toolCount ?? '-'}</Typography>
              <Typography variant="body2">
                Secrets: {manifest.secrets.length ? manifest.secrets.join(', ') : 'none declared'}
              </Typography>
            </Stack>
          ) : (
            <Typography variant="body2" sx={{ mt: 1 }}>
              Manifest unavailable ({displayStatus === 'disabled' ? 'plugin disabled' : 'plugin quarantined'}).
            </Typography>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="overline">Health</Typography>
          <Stack spacing={1} sx={{ mt: 1, alignItems: 'flex-start' }}>
            <Button variant="outlined" onClick={() => health.mutate()} disabled={health.isPending}>
              Check health
            </Button>
            {health.isError && (
              <Typography variant="body2" color="error">
                {pluginErrorMessage(health.error, 'Health check failed.')}
              </Typography>
            )}
            {health.data !== undefined && (
              <Box component="pre" sx={{ m: 0, fontSize: 12, overflow: 'auto' }}>
                {JSON.stringify(health.data, null, 2)}
              </Box>
            )}
          </Stack>
        </CardContent>
      </Card>

      <Box>
        <Button component={Link} href={`/plugins/settings/?id=${id}`}>
          Settings
        </Button>
      </Box>
    </Stack>
  )
}

function PluginDetailRoute() {
  const params = useSearchParams()
  const id = params.get('id') ?? ''

  if (!id) {
    return <Typography variant="body2">No plugin ID in the URL.</Typography>
  }

  return <PluginDetail id={id} />
}

export default function Page() {
  return (
    <Shell>
      <Suspense fallback={<Typography variant="body2">Loading...</Typography>}>
        <PluginDetailRoute />
      </Suspense>
    </Shell>
  )
}
