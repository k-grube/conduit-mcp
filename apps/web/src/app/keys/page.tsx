'use client'

import { useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormHelperText,
  IconButton,
  InputLabel,
  ListItemText,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import AutorenewIcon from '@mui/icons-material/Autorenew'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import DeleteIcon from '@mui/icons-material/Delete'
import { Confirm } from '../../components/confirm'
import { ErrorState } from '../../components/error-state'
import { Shell } from '../../components/shell'
import { useSnackbar } from '../../components/snackbar'
import { useRoles, type Role } from '../../lib/role-queries'
import {
  keyErrorMessage,
  useApiKeys,
  useCreateApiKey,
  useDeleteApiKey,
  type ApiKey,
  type CreateKeyResult,
} from '../../lib/key-queries'

interface RawKeyModalState extends CreateKeyResult {
  rotatingOldId?: string
}

export default function Page() {
  const { data, isLoading, isError, refetch } = useApiKeys()
  const { data: rolesData } = useRoles()
  const { notify } = useSnackbar()

  const createMutation = useCreateApiKey()
  const deleteMutation = useDeleteApiKey()

  const [createOpen, setCreateOpen] = useState(false)
  const [deleteId, setDeleteId] = useState<string | undefined>(undefined)
  const [rawKeyModal, setRawKeyModal] = useState<RawKeyModalState | undefined>(undefined)

  const roles = rolesData ?? []
  const mcpRoles = roles.filter((r) => r.surfaces.includes('mcp'))

  function roleName(id: string): string {
    return roles.find((r) => r.id === id)?.name ?? id
  }

  function confirmDelete(): Promise<void> {
    if (!deleteId) {
      return Promise.resolve()
    }
    const id = deleteId
    return new Promise((resolve) => {
      deleteMutation.mutate(id, {
        onError: (err) => notify(keyErrorMessage(err, 'Failed to delete key.')),
        onSettled: () => {
          setDeleteId(undefined)
          resolve()
        },
      })
    })
  }

  function rotate(key: ApiKey) {
    // guards against a double-click racing two creates while the first is still in flight
    if (createMutation.isPending) {
      return
    }
    createMutation.mutate(
      { name: key.name, roleIds: key.roleIds },
      {
        onSuccess: (result) => {
          setRawKeyModal({ ...result, rotatingOldId: key.id })
          // drop rawKey from the mutation cache now that it's captured in local state
          createMutation.reset()
        },
        onError: (err) => notify(keyErrorMessage(err, 'Failed to rotate key.')),
      },
    )
  }

  // rawKey lives only in this local state, cleared on close, never in the query cache
  function closeRawKeyModal() {
    const modal = rawKeyModal
    setRawKeyModal(undefined)
    if (modal?.rotatingOldId) {
      deleteMutation.mutate(modal.rotatingOldId, {
        onError: (err) => notify(keyErrorMessage(err, 'Failed to remove old key.')),
      })
    }
  }

  return (
    <Shell>
      <Stack spacing={2}>
        <Box>
          <Button variant="contained" onClick={() => setCreateOpen(true)}>
            Create key
          </Button>
        </Box>

        {isError && <ErrorState onRetry={() => refetch()} />}
        {isLoading && <Typography variant="body2">Loading...</Typography>}

        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Roles</TableCell>
                <TableCell>Created</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(data ?? []).map((key) => (
                <TableRow key={key.id}>
                  <TableCell>{key.name}</TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap' }}>
                      {key.roleIds.map((id) => (
                        <Chip key={id} size="small" label={roleName(id)} />
                      ))}
                    </Stack>
                  </TableCell>
                  <TableCell>{new Date(key.createdAt).toLocaleString()}</TableCell>
                  <TableCell align="right">
                    <IconButton
                      aria-label="Rotate key"
                      size="small"
                      onClick={() => rotate(key)}
                      disabled={createMutation.isPending}
                    >
                      <AutorenewIcon fontSize="small" />
                    </IconButton>
                    <IconButton aria-label="Delete key" size="small" onClick={() => setDeleteId(key.id)}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Stack>

      <Confirm
        open={deleteId !== undefined}
        title="Delete API key"
        message="Delete this key? Anything using it stops authenticating immediately."
        onCancel={() => setDeleteId(undefined)}
        onConfirm={confirmDelete}
      />

      {createOpen && (
        <CreateKeyDialog
          mcpRoles={mcpRoles}
          onClose={() => setCreateOpen(false)}
          onCreated={(result) => {
            setCreateOpen(false)
            setRawKeyModal(result)
          }}
        />
      )}

      <RawKeyDialog modal={rawKeyModal} onClose={closeRawKeyModal} />
    </Shell>
  )
}

interface CreateKeyDialogProps {
  mcpRoles: Role[]
  onClose: () => void
  onCreated: (result: CreateKeyResult) => void
}

function CreateKeyDialog({ mcpRoles, onClose, onCreated }: CreateKeyDialogProps) {
  const createMutation = useCreateApiKey()
  const [name, setName] = useState('')
  const [roleIds, setRoleIds] = useState<string[]>([])
  const [error, setError] = useState<string | undefined>(undefined)
  const [submitted, setSubmitted] = useState(false)

  const nameInvalid = name.trim().length === 0
  const rolesInvalid = roleIds.length === 0
  const nameErrorText = submitted && nameInvalid ? 'Name is required.' : undefined
  const rolesErrorText = submitted && rolesInvalid ? 'Select at least one role.' : undefined

  function handleCreate() {
    setError(undefined)
    setSubmitted(true)
    if (nameInvalid || rolesInvalid) {
      return
    }
    createMutation.mutate(
      { name: name.trim(), roleIds },
      {
        onSuccess: (result) => {
          onCreated(result)
          // drop rawKey from the mutation cache now that it's captured in the parent's local state
          createMutation.reset()
        },
        onError: (err) => setError(keyErrorMessage(err, 'Failed to create key.')),
      },
    )
  }

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Create key</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            error={Boolean(nameErrorText)}
            helperText={nameErrorText}
            size="small"
          />
          <FormControl size="small" error={Boolean(rolesErrorText)}>
            <InputLabel id="key-roles-label">Roles</InputLabel>
            <Select
              labelId="key-roles-label"
              label="Roles"
              multiple
              value={roleIds}
              onChange={(e) => {
                const next = e.target.value
                setRoleIds(typeof next === 'string' ? next.split(',') : next)
              }}
              renderValue={(selected) => selected.map((id) => mcpRoles.find((r) => r.id === id)?.name ?? id).join(', ')}
            >
              {mcpRoles.map((r) => (
                <MenuItem key={r.id} value={r.id}>
                  <Checkbox checked={roleIds.includes(r.id)} />
                  <ListItemText primary={r.name} />
                </MenuItem>
              ))}
            </Select>
            {rolesErrorText && <FormHelperText>{rolesErrorText}</FormHelperText>}
          </FormControl>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={createMutation.isPending}>
          Cancel
        </Button>
        <Button variant="contained" onClick={handleCreate} disabled={createMutation.isPending}>
          Create
        </Button>
      </DialogActions>
    </Dialog>
  )
}

interface RawKeyDialogProps {
  modal: RawKeyModalState | undefined
  onClose: () => void
}

// no onClose wired to backdrop/escape: MUI only closes on the explicit button below
function RawKeyDialog({ modal, onClose }: RawKeyDialogProps) {
  return (
    <Dialog open={modal !== undefined} maxWidth="sm" fullWidth>
      <DialogTitle>API key created</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Alert severity="warning">Shown once, store it now.</Alert>
          <TextField
            label="Raw key"
            value={modal?.rawKey ?? ''}
            size="small"
            slotProps={{
              input: {
                readOnly: true,
                endAdornment: (
                  <IconButton
                    aria-label="Copy raw key"
                    size="small"
                    onClick={() => {
                      void navigator.clipboard?.writeText(modal?.rawKey ?? '')
                    }}
                  >
                    <ContentCopyIcon fontSize="small" />
                  </IconButton>
                ),
              },
            }}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button variant="contained" onClick={onClose}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  )
}
