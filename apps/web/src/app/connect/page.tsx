'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Box, Card, CardContent, IconButton, Link as MuiLink, Stack, TextField, Typography } from '@mui/material'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import { Shell } from '../../components/shell'

export default function Page() {
  // window is unavailable during the static-export prerender, resolve origin after mount
  const [origin, setOrigin] = useState('')
  useEffect(() => {
    setOrigin(window.location.origin)
  }, [])
  const mcpUrl = `${origin}/mcp`

  return (
    <Shell>
      <Stack spacing={2}>
        <Card>
          <CardContent>
            <Typography variant="h6">Server URL</Typography>
            <Stack spacing={2} sx={{ pt: 1 }}>
              <Typography variant="body2" color="text.secondary">
                Point any MCP client at this URL. Sign in with your Entra account, or send an API key instead.
              </Typography>
              <TextField
                label="MCP server URL"
                value={mcpUrl}
                size="small"
                slotProps={{
                  input: {
                    readOnly: true,
                    endAdornment: (
                      <IconButton
                        aria-label="Copy server URL"
                        size="small"
                        onClick={() => {
                          void navigator.clipboard?.writeText(mcpUrl)
                        }}
                      >
                        <ContentCopyIcon fontSize="small" />
                      </IconButton>
                    ),
                  },
                }}
              />
            </Stack>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <Typography variant="h6">Claude Desktop</Typography>
            <Stack spacing={1} sx={{ pt: 1 }}>
              <Typography variant="body2">1. Settings, Connectors, Add custom connector.</Typography>
              <Typography variant="body2">2. Name it Conduit, paste the server URL, then Add.</Typography>
              <Typography variant="body2">3. Click Connect and sign in with your Entra account.</Typography>
            </Stack>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <Typography variant="h6">claude.ai</Typography>
            <Stack spacing={1} sx={{ pt: 1 }}>
              <Typography variant="body2">
                Workspace admins add it under Settings, Connectors, Add custom connector with the same server URL.
              </Typography>
              <Typography variant="body2">
                Each member connects it from the tools menu in a chat and signs in with their Entra account.
              </Typography>
            </Stack>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <Typography variant="h6">Claude Code</Typography>
            <Stack spacing={2} sx={{ pt: 1 }}>
              <Typography variant="body2">Add the server, then run /mcp inside a session to sign in:</Typography>
              <CommandBlock
                command={`claude mcp add --transport http conduit ${mcpUrl}`}
                copyLabel="Copy Claude Code command"
              />
              <Typography variant="body2">
                To skip the sign-in (CI, shared machines), send an API key from{' '}
                <MuiLink component={Link} href="/keys/">
                  API Keys
                </MuiLink>{' '}
                instead:
              </Typography>
              <CommandBlock
                command={`claude mcp add --transport http conduit ${mcpUrl} --header "x-api-key: <key>"`}
                copyLabel="Copy Claude Code API key command"
              />
            </Stack>
          </CardContent>
        </Card>
      </Stack>
    </Shell>
  )
}

function CommandBlock({ command, copyLabel }: { command: string; copyLabel: string }) {
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
      <Box
        component="code"
        sx={{
          flexGrow: 1,
          p: 1,
          bgcolor: 'action.hover',
          borderRadius: 1,
          fontFamily: 'monospace',
          fontSize: 13,
          overflowX: 'auto',
          whiteSpace: 'nowrap',
        }}
      >
        {command}
      </Box>
      <IconButton
        aria-label={copyLabel}
        size="small"
        onClick={() => {
          void navigator.clipboard?.writeText(command)
        }}
      >
        <ContentCopyIcon fontSize="small" />
      </IconButton>
    </Stack>
  )
}
