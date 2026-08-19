'use client'

import { useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import { ErrorState } from '../components/error-state'
import { Shell } from '../components/shell'
import { useDashboard } from '../lib/queries'
import { useUpdateStatus } from '../lib/system-queries'

const DAY_OPTIONS = [7, 30, 90]

function UpdateBanner() {
  const { data } = useUpdateStatus()
  if (!data?.updateAvailable) {
    return null
  }
  return (
    <Alert
      severity="warning"
      action={
        <Button color="inherit" size="small" href="/settings">
          Settings
        </Button>
      }
    >
      Update available: running {data.runningSha?.slice(0, 7)}, registry has {data.remoteSha?.slice(0, 7)}.
    </Alert>
  )
}

export default function Page() {
  const [days, setDays] = useState(7)
  const { data, isLoading, isError, refetch } = useDashboard(days)
  const tools = [...(data?.tools ?? [])].sort((a, b) => b.calls - a.calls)

  return (
    <Shell>
      <Stack spacing={3}>
        <UpdateBanner />
        <ToggleButtonGroup
          exclusive
          value={days}
          onChange={(_e, value) => {
            if (value !== null) {
              setDays(value)
            }
          }}
        >
          {DAY_OPTIONS.map((d) => (
            <ToggleButton key={d} value={d}>
              {d}d
            </ToggleButton>
          ))}
        </ToggleButtonGroup>

        {isError && <ErrorState onRetry={() => refetch()} />}

        {isLoading && <Typography variant="body2">Loading...</Typography>}

        {data && (
          <>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                borderBottom: 2,
                borderColor: 'divider',
              }}
            >
              {(
                [
                  ['Calls', data.totals.calls],
                  ['Errors', data.totals.errors],
                  ['Avg ms', data.totals.avgMs],
                ] as const
              ).map(([kpiLabel, value]) => (
                <Box
                  key={kpiLabel}
                  sx={{
                    p: 4,
                    borderRight: '1px solid rgba(var(--mui-palette-text-primaryChannel) / 0.2)',
                    '&:last-child': { borderRight: 0 },
                  }}
                >
                  <Typography variant="overline">{kpiLabel}</Typography>
                  <Typography variant="h4">{value}</Typography>
                </Box>
              ))}
            </Box>

            <TableContainer component={Paper}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Day</TableCell>
                    <TableCell align="right">Calls</TableCell>
                    <TableCell align="right">Errors</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.daily.map((d) => (
                    <TableRow key={d.day}>
                      <TableCell>{d.day}</TableCell>
                      <TableCell align="right">{d.calls}</TableCell>
                      <TableCell align="right">{d.errors}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>

            <TableContainer component={Paper}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Tool</TableCell>
                    <TableCell>Plugin</TableCell>
                    <TableCell align="right">Calls</TableCell>
                    <TableCell align="right">Errors</TableCell>
                    <TableCell align="right">Avg ms</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {tools.map((t) => (
                    <TableRow key={t.tool}>
                      <TableCell>{t.tool}</TableCell>
                      <TableCell>{t.pluginId}</TableCell>
                      <TableCell align="right">{t.calls}</TableCell>
                      <TableCell align="right">{t.errors}</TableCell>
                      <TableCell align="right">{t.avgMs}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>

            <TableContainer component={Paper}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Principal</TableCell>
                    <TableCell align="right">Calls</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.principals.map((p) => (
                    <TableRow key={p.principal}>
                      <TableCell>{p.principal}</TableCell>
                      <TableCell align="right">{p.calls}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </>
        )}
      </Stack>
    </Shell>
  )
}
