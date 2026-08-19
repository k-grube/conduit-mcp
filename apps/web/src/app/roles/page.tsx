'use client'

import { useMemo, useState } from 'react'
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
  FormControlLabel,
  FormHelperText,
  IconButton,
  Paper,
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
import DeleteIcon from '@mui/icons-material/Delete'
import { useAuth } from '../../components/auth-gate'
import { Confirm } from '../../components/confirm'
import { ErrorState } from '../../components/error-state'
import { GrantsEditor } from '../../components/grants-editor'
import { MemberPicker } from '../../components/member-picker'
import { Shell } from '../../components/shell'
import { useSnackbar } from '../../components/snackbar'
import { useTools } from '../../lib/queries'
import {
  roleErrorMessage,
  useCreateRole,
  useDeleteRole,
  useRoles,
  useUpdateRole,
  useUpdateRoleMembers,
  type Grant,
  type Role,
  type RoleInput,
  type RoleMembers,
  type Surface,
} from '../../lib/role-queries'

const SURFACE_LABELS: Record<Surface, string> = { portal: 'Portal', mcp: 'MCP' }

export default function Page() {
  const { data, isLoading, isError, refetch } = useRoles()
  const { data: toolsData } = useTools()
  const { notify } = useSnackbar()

  const [dialogTarget, setDialogTarget] = useState<Role | 'new' | undefined>(undefined)
  const [deleteId, setDeleteId] = useState<string | undefined>(undefined)

  const deleteMutation = useDeleteRole()

  const integrations = useMemo(() => {
    const ids = new Set((toolsData?.tools ?? []).map((t) => t.pluginId))
    return [...ids].sort()
  }, [toolsData])

  const toolNames = useMemo(() => (toolsData?.tools ?? []).map((t) => t.name).sort(), [toolsData])

  function confirmDelete(): Promise<void> {
    if (!deleteId) {
      return Promise.resolve()
    }
    const id = deleteId
    return new Promise((resolve) => {
      deleteMutation.mutate(id, {
        onError: (err) => notify(roleErrorMessage(err, 'Failed to delete role.')),
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
          <Button variant="contained" onClick={() => setDialogTarget('new')}>
            New role
          </Button>
        </Box>

        {isError && <ErrorState onRetry={() => refetch()} />}
        {isLoading && <Typography variant="body2">Loading...</Typography>}

        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>ID</TableCell>
                <TableCell>Surfaces</TableCell>
                <TableCell align="right">Grants</TableCell>
                <TableCell align="right">Members</TableCell>
                <TableCell>Built-in</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(data ?? []).map((role) => (
                <TableRow key={role.id} hover onClick={() => setDialogTarget(role)} sx={{ cursor: 'pointer' }}>
                  <TableCell>{role.name}</TableCell>
                  <TableCell>{role.id}</TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.5}>
                      {role.surfaces.map((s) => (
                        <Chip key={s} size="small" label={SURFACE_LABELS[s] ?? s} />
                      ))}
                    </Stack>
                  </TableCell>
                  <TableCell align="right">{role.grants.length}</TableCell>
                  <TableCell align="right">{role.members.users.length + role.members.groups.length}</TableCell>
                  <TableCell>{role.builtin && <Chip size="small" label="Built-in" />}</TableCell>
                  <TableCell align="right">
                    {!role.builtin && (
                      <IconButton
                        aria-label="Delete role"
                        size="small"
                        onClick={(e) => {
                          e.stopPropagation()
                          setDeleteId(role.id)
                        }}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Stack>

      <Confirm
        open={deleteId !== undefined}
        title="Delete role"
        message={`Delete ${deleteId}? Members lose this role's grants immediately.`}
        onCancel={() => setDeleteId(undefined)}
        onConfirm={confirmDelete}
      />

      {dialogTarget !== undefined && (
        <RoleDialog
          role={dialogTarget === 'new' ? undefined : dialogTarget}
          integrations={integrations}
          toolNames={toolNames}
          onClose={() => setDialogTarget(undefined)}
        />
      )}
    </Shell>
  )
}

// requirePortalAdmin (server) gates every admin write on membership in this exact role
const PORTAL_ADMIN_ROLE_ID = 'portal-admin'

const ID_PATTERN = /^[a-z][a-z0-9-]*$/

interface RoleDialogProps {
  role?: Role
  integrations: string[]
  toolNames: string[]
  onClose: () => void
}

function RoleDialog({ role, integrations, toolNames, onClose }: RoleDialogProps) {
  const { account } = useAuth()
  const createMutation = useCreateRole()
  const updateMutation = useUpdateRole()
  const updateMembersMutation = useUpdateRoleMembers()

  const [id, setId] = useState(role?.id ?? '')
  const [name, setName] = useState(role?.name ?? '')
  const [surfaces, setSurfaces] = useState<Surface[]>(role?.surfaces ?? ['mcp'])
  const [grants, setGrants] = useState<Grant[]>(role?.grants ?? [])
  const [members, setMembers] = useState<RoleMembers>(role?.members ?? { users: [], groups: [] })
  const [error, setError] = useState<string | undefined>(undefined)
  const [submitted, setSubmitted] = useState(false)
  const [lockoutWarning, setLockoutWarning] = useState<string | undefined>(undefined)

  const builtin = Boolean(role?.builtin)
  const pending = createMutation.isPending || updateMutation.isPending || updateMembersMutation.isPending

  const idInvalid = role === undefined && !(id.length <= 40 && ID_PATTERN.test(id))
  const surfacesInvalid = surfaces.length === 0
  const idErrorText =
    submitted && idInvalid ? 'Lowercase kebab-case, starts with a letter, max 40 characters.' : undefined
  const surfacesErrorText = submitted && surfacesInvalid ? 'Select at least one surface.' : undefined

  function toggleSurface(surface: Surface, checked: boolean) {
    setSurfaces((prev) => (checked ? [...prev, surface] : prev.filter((s) => s !== surface)))
  }

  // removing your own oid, or any group, from portal-admin risks losing admin access with no recovery path
  function pendingLockoutWarning(): string | undefined {
    if (!role || role.id !== PORTAL_ADMIN_ROLE_ID) {
      return undefined
    }
    if (account && role.members.users.includes(account.oid) && !members.users.includes(account.oid)) {
      return 'You are removing your own portal admin access.'
    }
    if (role.members.groups.some((g) => !members.groups.includes(g))) {
      return 'Removing a group from portal admin. Make sure another admin keeps access.'
    }
    return undefined
  }

  function submitMembersOnly() {
    if (!role) {
      return
    }
    updateMembersMutation.mutate(
      { id: role.id, members },
      {
        onSuccess: () => onClose(),
        onError: (err) => setError(roleErrorMessage(err, 'Failed to save role.')),
      },
    )
  }

  function handleSave() {
    setError(undefined)
    if (builtin && role) {
      const warning = pendingLockoutWarning()
      if (warning) {
        setLockoutWarning(warning)
        return
      }
      submitMembersOnly()
      return
    }
    setSubmitted(true)
    if (idInvalid || surfacesInvalid) {
      return
    }
    const input: RoleInput = { id, name, grants, surfaces, members }
    const mutation = role === undefined ? createMutation : updateMutation
    mutation.mutate(input, {
      onSuccess: () => onClose(),
      onError: (err) => setError(roleErrorMessage(err, 'Failed to save role.')),
    })
  }

  return (
    <>
      <Dialog open onClose={onClose} maxWidth="md" fullWidth>
        <DialogTitle>{role === undefined ? 'New role' : role.id}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {error && <Alert severity="error">{error}</Alert>}
            {builtin && <Alert severity="info">Built-in role. Members only.</Alert>}
            <TextField
              label="ID"
              value={id}
              onChange={(e) => setId(e.target.value)}
              disabled={role !== undefined}
              error={Boolean(idErrorText)}
              helperText={idErrorText ?? 'Lowercase kebab-case, e.g. halo-read-only'}
              size="small"
            />
            <TextField
              label="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={builtin}
              size="small"
            />
            <Stack>
              <Stack direction="row" spacing={2}>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={surfaces.includes('portal')}
                      onChange={(e) => toggleSurface('portal', e.target.checked)}
                      disabled={builtin}
                    />
                  }
                  label={SURFACE_LABELS.portal}
                />
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={surfaces.includes('mcp')}
                      onChange={(e) => toggleSurface('mcp', e.target.checked)}
                      disabled={builtin}
                    />
                  }
                  label={SURFACE_LABELS.mcp}
                />
              </Stack>
              {surfacesErrorText && <FormHelperText error>{surfacesErrorText}</FormHelperText>}
            </Stack>
            <Typography variant="subtitle2">Grants</Typography>
            <GrantsEditor
              value={grants}
              onChange={setGrants}
              integrations={integrations}
              toolNames={toolNames}
              disabled={builtin}
            />
            <Typography variant="subtitle2">Members</Typography>
            <MemberPicker value={members} onChange={setMembers} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="contained" onClick={handleSave} disabled={pending}>
            Save
          </Button>
        </DialogActions>
      </Dialog>

      <Confirm
        open={lockoutWarning !== undefined}
        title="Portal admin access"
        message={lockoutWarning ?? ''}
        onCancel={() => setLockoutWarning(undefined)}
        onConfirm={() => {
          setLockoutWarning(undefined)
          submitMembersOnly()
        }}
      />
    </>
  )
}
