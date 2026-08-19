'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Markdown from 'markdown-to-jsx'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Card,
  CardContent,
  Link as MuiLink,
  Stack,
  Typography,
} from '@mui/material'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import { CustomBundle } from '../../../components/custom-bundle'
import { ErrorState } from '../../../components/error-state'
import { PluginActions } from '../../../components/plugin-actions'
import { SchemaForm, type SchemaFormSaveResult } from '../../../components/schema-form'
import { Shell } from '../../../components/shell'
import { useSnackbar } from '../../../components/snackbar'
import {
  pluginErrorMessage,
  usePlugin,
  usePluginConfig,
  usePluginSecrets,
  useUpdatePluginConfig,
  useUpdatePluginSecrets,
} from '../../../lib/plugin-queries'

function PluginSettings({ id }: { id: string }) {
  const { data, isLoading, isError, refetch } = usePlugin(id)
  const configQuery = usePluginConfig(id)
  const secretsQuery = usePluginSecrets(id)
  const updateConfig = useUpdatePluginConfig(id)
  const updateSecrets = useUpdatePluginSecrets(id)
  const { notify } = useSnackbar()

  if (isError || configQuery.isError || secretsQuery.isError) {
    return (
      <ErrorState
        onRetry={() => {
          refetch()
          configQuery.refetch()
          secretsQuery.refetch()
        }}
      />
    )
  }
  if (isLoading || !data || configQuery.isLoading || secretsQuery.isLoading) {
    return <Typography variant="body2">Loading...</Typography>
  }

  const { manifest } = data

  if (!manifest) {
    return <Alert severity="warning">Manifest unavailable (plugin quarantined).</Alert>
  }

  async function handleSave({ config, secretValues }: SchemaFormSaveResult): Promise<boolean> {
    try {
      await updateConfig.mutateAsync(config)
    } catch (err) {
      notify(pluginErrorMessage(err, 'Failed to save settings.'))
      return false
    }
    if (Object.keys(secretValues).length > 0) {
      try {
        await updateSecrets.mutateAsync(secretValues)
      } catch (err) {
        notify(pluginErrorMessage(err, 'Failed to save secrets.'))
        return false
      }
    }
    notify('Settings saved.', 'success')
    return true
  }

  return (
    <Stack spacing={2}>
      <Typography variant="h5">{id} settings</Typography>

      {manifest.ui.setupHelp && <SetupGuide markdown={manifest.ui.setupHelp} configured={data.configured} />}

      {manifest.ui.customBundle ? (
        <CustomBundle pluginId={id} route={manifest.ui.customBundle} />
      ) : (
        <Card>
          <CardContent>
            <SchemaForm
              fields={manifest.ui.settings}
              values={configQuery.data ?? {}}
              secretStatus={secretsQuery.data ?? []}
              onSave={handleSave}
              saving={updateConfig.isPending || updateSecrets.isPending}
            />
          </CardContent>
        </Card>
      )}

      {manifest.ui.actions.length > 0 && (
        <Card>
          <CardContent>
            <Typography variant="overline">Actions</Typography>
            <Box sx={{ mt: 1 }}>
              <PluginActions actions={manifest.ui.actions} pluginId={id} />
            </Box>
          </CardContent>
        </Card>
      )}
    </Stack>
  )
}

function SetupGuide({ markdown, configured }: { markdown: string; configured: boolean }) {
  return (
    <Accordion defaultExpanded={!configured}>
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Typography variant="overline">Setup guide</Typography>
      </AccordionSummary>
      <AccordionDetails>
        <Box
          sx={{
            typography: 'body2',
            '& p, & li': { my: 0.5 },
            '& code': { px: 0.5, borderRadius: 0.5, bgcolor: 'action.hover', fontSize: 13 },
          }}
        >
          <Markdown options={{ disableParsingRawHTML: true, overrides: { a: { component: MuiLink } } }}>
            {markdown}
          </Markdown>
        </Box>
      </AccordionDetails>
    </Accordion>
  )
}

function PluginSettingsRoute() {
  const params = useSearchParams()
  const id = params.get('id') ?? ''

  if (!id) {
    return <Typography variant="body2">No plugin ID in the URL.</Typography>
  }

  return <PluginSettings id={id} />
}

export default function Page() {
  return (
    <Shell>
      <Suspense fallback={<Typography variant="body2">Loading...</Typography>}>
        <PluginSettingsRoute />
      </Suspense>
    </Shell>
  )
}
