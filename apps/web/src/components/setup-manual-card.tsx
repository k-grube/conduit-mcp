'use client'

import { useState } from 'react'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Button,
  Card,
  CardContent,
  List,
  ListItem,
  ListItemText,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import type { SetupStatusPayload } from './setup-wizard'
import { setupTokenHeaders } from '../lib/setup-token'

interface SetupManualCardProps {
  status: SetupStatusPayload
  onChanged(): void
}

const CHECKLIST_ITEMS = [
  'Single tenant app (sign-in audience: this org only)',
  'SPA redirect URIs: this origin and http://localhost:3000',
  'Web redirect URIs: claude.ai and the localhost MCP callback',
  'Expose portal.access and mcp.access scopes under api://<clientId>',
  'Token version 2 (requestedAccessTokenVersion)',
  'Group claims: SecurityGroup',
  'Fallback public client enabled',
  'Graph app permissions User.Read.All and Group.Read.All, with admin consent granted',
]

export function SetupManualCard({ status }: SetupManualCardProps) {
  const [tenantId, setTenantId] = useState('')
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [warning, setWarning] = useState<string | undefined>(undefined)

  const signInRequired = status.oidLockActive && !status.session?.authenticated

  async function handleSubmit() {
    setSubmitting(true)
    setError(undefined)
    try {
      const body: Record<string, string> = { tenantId, clientId }
      if (status.secretsWritable && clientSecret) {
        body.clientSecret = clientSecret
      }
      const res = await fetch('/api/setup/manual', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...setupTokenHeaders() },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Failed to configure.')
        return
      }
      if (data.warning) {
        setWarning(data.warning)
        setTimeout(() => window.location.reload(), 3000)
        return
      }
      window.location.reload()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card sx={{ flex: 1, maxWidth: 480 }}>
      <CardContent>
        <Stack spacing={2}>
          <Typography variant="subtitle1">Manual entry</Typography>
          <Typography variant="body2" color="text.secondary">
            {status.session?.authenticated
              ? `Signed in as ${status.session.user?.name ?? status.session.user?.upn}. This account is seeded as admin.`
              : 'Not signed in. Admin roles come from BOOTSTRAP_ADMIN_OID at boot unless you sign in first.'}
          </Typography>
          <TextField label="Tenant ID" value={tenantId} onChange={(e) => setTenantId(e.target.value)} size="small" />
          <TextField label="Client ID" value={clientId} onChange={(e) => setClientId(e.target.value)} size="small" />
          {status.secretsWritable ? (
            <TextField
              label="Client secret"
              type="password"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              size="small"
            />
          ) : (
            <Typography variant="body2">
              Put the client secret in .dev.env as AZURE_CLIENT_SECRET before configuring.
            </Typography>
          )}
          {signInRequired && (
            <Typography variant="body2" color="error">
              Sign in with the device code first (identity check).
            </Typography>
          )}
          {error && <Typography color="error">{error}</Typography>}
          {warning && <Typography variant="body2">{warning}</Typography>}
          <Button
            variant="contained"
            onClick={handleSubmit}
            disabled={submitting || signInRequired || Boolean(warning)}
          >
            Configure
          </Button>
          <Accordion>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Typography variant="body2">Manual app registration checklist</Typography>
            </AccordionSummary>
            <AccordionDetails>
              <List dense>
                {CHECKLIST_ITEMS.map((item) => (
                  <ListItem key={item}>
                    <ListItemText primary={item} />
                  </ListItem>
                ))}
              </List>
            </AccordionDetails>
          </Accordion>
        </Stack>
      </CardContent>
    </Card>
  )
}
