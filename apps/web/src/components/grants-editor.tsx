'use client'

import { useState } from 'react'
import { Autocomplete, Box, Button, Chip, IconButton, Menu, MenuItem, Stack, TextField } from '@mui/material'
import DeleteIcon from '@mui/icons-material/Delete'
import type { Grant, GrantMode } from '../lib/role-queries'

interface GrantsEditorProps {
  value: Grant[]
  onChange: (grants: Grant[]) => void
  integrations: string[]
  toolNames: string[]
  disabled?: boolean
}

const MODE_LABELS: Record<GrantMode, string> = { read: 'Read', write: 'Write', all: 'All' }

const MODES: GrantMode[] = ['read', 'write', 'all']

export function GrantsEditor({ value, onChange, integrations, toolNames, disabled }: GrantsEditorProps) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | undefined>(undefined)
  const integrationOptions = ['*', ...integrations]

  function updateRow(index: number, grant: Grant) {
    onChange(value.map((g, i) => (i === index ? grant : g)))
  }

  function removeRow(index: number) {
    onChange(value.filter((_, i) => i !== index))
  }

  function addWildcard() {
    onChange([...value, { kind: 'wildcard_all' }])
    setAnchorEl(undefined)
  }

  function addIntegration() {
    onChange([...value, { kind: 'integration', integrationId: integrationOptions[0], mode: 'read' }])
    setAnchorEl(undefined)
  }

  function addTool() {
    onChange([...value, { kind: 'tool', toolName: toolNames[0] ?? '' }])
    setAnchorEl(undefined)
  }

  function addNotesWrite() {
    onChange([...value, { kind: 'notes_write' }])
    setAnchorEl(undefined)
  }

  return (
    <Stack spacing={1}>
      {value.map((grant, index) => (
        <Stack key={index} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          {grant.kind === 'wildcard_all' && <Chip label="Wildcard: all access" />}
          {grant.kind === 'integration' && (
            <>
              <TextField
                select
                label="Integration"
                value={grant.integrationId}
                onChange={(e) => updateRow(index, { ...grant, integrationId: e.target.value })}
                size="small"
                disabled={disabled}
                sx={{ minWidth: 180 }}
              >
                {integrationOptions.map((opt) => (
                  <MenuItem key={opt} value={opt}>
                    {opt}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                select
                label="Mode"
                value={grant.mode}
                onChange={(e) => updateRow(index, { ...grant, mode: e.target.value as GrantMode })}
                size="small"
                disabled={disabled}
                sx={{ minWidth: 120 }}
              >
                {MODES.map((m) => (
                  <MenuItem key={m} value={m}>
                    {MODE_LABELS[m]}
                  </MenuItem>
                ))}
              </TextField>
            </>
          )}
          {grant.kind === 'tool' && (
            <Autocomplete
              options={toolNames}
              value={grant.toolName}
              onChange={(_e, newValue) => updateRow(index, { ...grant, toolName: newValue ?? '' })}
              disabled={disabled}
              renderInput={(params) => <TextField {...params} label="Tool" size="small" />}
              sx={{ minWidth: 240 }}
            />
          )}
          {grant.kind === 'notes_write' && <Chip label="Tool notes: write" />}
          <IconButton aria-label="Remove grant" onClick={() => removeRow(index)} disabled={disabled} size="small">
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Stack>
      ))}
      <Box>
        <Button size="small" onClick={(e) => setAnchorEl(e.currentTarget)} disabled={disabled}>
          Add grant
        </Button>
        <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={() => setAnchorEl(undefined)}>
          <MenuItem onClick={addWildcard}>Wildcard (all access)</MenuItem>
          <MenuItem onClick={addIntegration}>Integration</MenuItem>
          <MenuItem onClick={addTool}>Tool</MenuItem>
          <MenuItem onClick={addNotesWrite}>Tool notes (write)</MenuItem>
        </Menu>
      </Box>
    </Stack>
  )
}
