'use client'

import { useState } from 'react'
import {
  Box,
  Chip,
  Drawer,
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
import { ErrorState } from '../../components/error-state'
import { Shell } from '../../components/shell'
import { useActivity, type ActivityItem } from '../../lib/queries'

const LIMIT_OPTIONS = [50, 100, 200]

export default function Page() {
  const [limit, setLimit] = useState(50)
  const [selected, setSelected] = useState<ActivityItem | undefined>(undefined)
  const { data, isLoading, isError, refetch } = useActivity(limit)

  return (
    <Shell>
      <Stack spacing={2}>
        <ToggleButtonGroup
          exclusive
          value={limit}
          onChange={(_e, value) => {
            if (value !== null) {
              setLimit(value)
            }
          }}
        >
          {LIMIT_OPTIONS.map((l) => (
            <ToggleButton key={l} value={l}>
              {l}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>

        {isError && <ErrorState onRetry={() => refetch()} />}

        {isLoading && <Typography variant="body2">Loading...</Typography>}

        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Time</TableCell>
                <TableCell>Tool</TableCell>
                <TableCell>Principal</TableCell>
                <TableCell align="right">Duration</TableCell>
                <TableCell>Status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(data?.items ?? []).map((item) => (
                <TableRow key={item.rid} hover onClick={() => setSelected(item)} sx={{ cursor: 'pointer' }}>
                  <TableCell>{item.at}</TableCell>
                  <TableCell>{item.tool}</TableCell>
                  <TableCell>{item.principal}</TableCell>
                  <TableCell align="right">{item.durationMs}ms</TableCell>
                  <TableCell>
                    <Chip size="small" label={item.ok ? 'OK' : 'Error'} color={item.ok ? 'success' : 'error'} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Stack>

      <Drawer anchor="right" open={selected !== undefined} onClose={() => setSelected(undefined)}>
        <Box sx={{ width: 480, p: 2 }}>
          <Typography variant="h6">Record</Typography>
          <Box component="pre" sx={{ fontSize: 12, overflow: 'auto' }}>
            {JSON.stringify(selected, null, 2)}
          </Box>
        </Box>
      </Drawer>
    </Shell>
  )
}
