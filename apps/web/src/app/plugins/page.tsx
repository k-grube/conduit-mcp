'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  Menu,
  MenuItem,
  Paper,
  Radio,
  RadioGroup,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import { Confirm } from '../../components/confirm'
import { ErrorState } from '../../components/error-state'
import { Shell } from '../../components/shell'
import { useSnackbar } from '../../components/snackbar'
import {
  pluginErrorMessage,
  useDeletePlugin,
  useDisablePlugin,
  useEnablePlugin,
  usePlugins,
  useReloadPlugin,
  useRegisterPlugin,
  type PluginListItem,
  type PluginSource,
  type RegisterPluginInput,
} from '../../lib/plugin-queries'
import { STATUS_COLOR, STATUS_LABEL, statusTooltip } from '../../lib/plugin-status'

function sourceLabel(p: PluginListItem): string {
  if (p.source === 'git') {
    return p.ref ? `${p.repoUrl}@${p.ref}` : (p.repoUrl ?? '')
  }
  return p.localPath ?? ''
}

export default function Page() {
  const { data, isLoading, isError, refetch } = usePlugins()
  const { notify } = useSnackbar()
  const router = useRouter()

  const enableMutation = useEnablePlugin()
  const disableMutation = useDisablePlugin()
  const reloadMutation = useReloadPlugin()
  const deleteMutation = useDeletePlugin()

  const [registerOpen, setRegisterOpen] = useState(false)
  const [menu, setMenu] = useState<{ anchorEl: HTMLElement; id: string } | undefined>(undefined)
  const [deleteId, setDeleteId] = useState<string | undefined>(undefined)

  function toggleEnabled(plugin: PluginListItem, enabled: boolean) {
    const mutation = enabled ? enableMutation : disableMutation
    mutation.mutate(plugin.id, {
      onError: (err) => notify(pluginErrorMessage(err, 'Failed to update plugin.')),
    })
  }

  function reload(id: string) {
    reloadMutation.mutate(id, {
      onError: (err) => notify(pluginErrorMessage(err, 'Failed to reload plugin.')),
    })
  }

  function confirmDelete(): Promise<void> {
    if (!deleteId) {
      return Promise.resolve()
    }
    const id = deleteId
    return new Promise((resolve) => {
      deleteMutation.mutate(id, {
        onError: (err) => notify(pluginErrorMessage(err, 'Failed to delete plugin.')),
        onSettled: () => {
          setDeleteId(undefined)
          resolve()
        },
      })
    })
  }

  return (
    <Shell>
      <Stack spacing={2}>
        <Box>
          <Button variant="contained" onClick={() => setRegisterOpen(true)}>
            Register plugin
          </Button>
        </Box>

        {isError && <ErrorState onRetry={() => refetch()} />}
        {isLoading && <Typography variant="body2">Loading...</Typography>}

        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>ID</TableCell>
                <TableCell>Source</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Enabled</TableCell>
                <TableCell align="right">Tools</TableCell>
                <TableCell>Loaded</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(data ?? []).map((p) => (
                <TableRow key={p.id} hover>
                  <TableCell>{p.id}</TableCell>
                  <TableCell>{sourceLabel(p)}</TableCell>
                  <TableCell>
                    <Tooltip title={statusTooltip(p.displayStatus, p)}>
                      <Chip size="small" label={STATUS_LABEL[p.displayStatus]} color={STATUS_COLOR[p.displayStatus]} />
                    </Tooltip>
                  </TableCell>
                  <TableCell>
                    <Switch checked={p.enabled} onChange={(e) => toggleEnabled(p, e.target.checked)} />
                  </TableCell>
                  <TableCell align="right">{p.toolCount}</TableCell>
                  <TableCell>{p.loadedAt ?? '-'}</TableCell>
                  <TableCell align="right">
                    <IconButton onClick={(e) => setMenu({ anchorEl: e.currentTarget, id: p.id })}>
                      <MoreVertIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Stack>

      <Menu anchorEl={menu?.anchorEl} open={menu !== undefined} onClose={() => setMenu(undefined)}>
        <MenuItem
          onClick={() => {
            if (menu) {
              router.push(`/plugins/detail/?id=${menu.id}`)
            }
            setMenu(undefined)
          }}
        >
          Open detail
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (menu) {
              reload(menu.id)
            }
            setMenu(undefined)
          }}
        >
          Reload
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (menu) {
              setDeleteId(menu.id)
            }
            setMenu(undefined)
          }}
        >
          Delete
        </MenuItem>
      </Menu>

      <Confirm
        open={deleteId !== undefined}
        title="Delete plugin"
        message={`Delete ${deleteId}? This unloads it and removes the record.`}
        onCancel={() => setDeleteId(undefined)}
        onConfirm={confirmDelete}
      />

      <RegisterDialog open={registerOpen} onClose={() => setRegisterOpen(false)} />
    </Shell>
  )
}

function RegisterDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const registerMutation = useRegisterPlugin()
  const [source, setSource] = useState<PluginSource>('git')
  const [id, setId] = useState('')
  const [repoUrl, setRepoUrl] = useState('')
  const [ref, setRef] = useState('')
  const [localPath, setLocalPath] = useState('')
  const [error, setError] = useState<string | undefined>(undefined)

  function reset() {
    setSource('git')
    setId('')
    setRepoUrl('')
    setRef('')
    setLocalPath('')
    setError(undefined)
  }

  function handleClose() {
    reset()
    onClose()
  }

  function submit() {
    setError(undefined)
    const input: RegisterPluginInput =
      source === 'git' ? { id, source, repoUrl, ref: ref || undefined } : { id, source, localPath }
    registerMutation.mutate(input, {
      onSuccess: () => handleClose(),
      onError: (err) => setError(pluginErrorMessage(err, 'Failed to register plugin.')),
    })
  }

  return (
    <Dialog open={open} onClose={handleClose}>
      <DialogTitle>Register plugin</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1, minWidth: 360 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <RadioGroup row value={source} onChange={(e) => setSource(e.target.value as PluginSource)}>
            <FormControlLabel value="git" control={<Radio />} label="Git" />
            <FormControlLabel value="local" control={<Radio />} label="Local" />
          </RadioGroup>
          <TextField
            label="ID"
            value={id}
            onChange={(e) => setId(e.target.value)}
            helperText="Kebab-case, e.g. my-plugin"
            size="small"
          />
          {source === 'git' ? (
            <>
              <TextField label="Repo URL" value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} size="small" />
              <TextField label="Ref" value={ref} onChange={(e) => setRef(e.target.value)} size="small" />
            </>
          ) : (
            <TextField
              label="Local path"
              value={localPath}
              onChange={(e) => setLocalPath(e.target.value)}
              size="small"
            />
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>Cancel</Button>
        <Button variant="contained" onClick={submit} disabled={registerMutation.isPending}>
          Register
        </Button>
      </DialogActions>
    </Dialog>
  )
}
