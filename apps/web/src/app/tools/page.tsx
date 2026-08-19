'use client'

import { useMemo, useState } from 'react'
import { Box, Collapse, List, ListItemButton, ListItemText, Stack, TextField, Typography } from '@mui/material'
import { ErrorState } from '../../components/error-state'
import { Shell } from '../../components/shell'
import { useTools, type CatalogTool } from '../../lib/queries'

export default function Page() {
  const { data, isLoading, isError, refetch } = useTools()
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<string | undefined>(undefined)

  const filtered = useMemo(() => {
    const tools = data?.tools ?? []
    const q = search.trim().toLowerCase()
    if (!q) {
      return tools
    }
    return tools.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.pluginId.toLowerCase().includes(q),
    )
  }, [data, search])

  const groups = useMemo(() => {
    const map = new Map<string, CatalogTool[]>()
    for (const t of filtered) {
      const list = map.get(t.integrationName) ?? []
      list.push(t)
      map.set(t.integrationName, list)
    }
    return [...map.entries()]
  }, [filtered])

  return (
    <Shell>
      <Stack spacing={2}>
        <TextField
          label="Search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          size="small"
          sx={{ maxWidth: 320 }}
        />
        {isError && <ErrorState onRetry={() => refetch()} />}
        {isLoading && <Typography variant="body2">Loading...</Typography>}
        {groups.map(([integrationName, tools]) => (
          <Box key={integrationName}>
            <Typography variant="subtitle2">{integrationName}</Typography>
            <List dense>
              {tools.map((t) => (
                <Box key={t.name}>
                  <ListItemButton onClick={() => setExpanded(expanded === t.name ? undefined : t.name)}>
                    <ListItemText primary={t.name} secondary={t.description} />
                  </ListItemButton>
                  <Collapse in={expanded === t.name} unmountOnExit>
                    <Box component="pre" sx={{ m: 0, p: 2, fontSize: 12, overflow: 'auto' }}>
                      {JSON.stringify(t.jsonSchema, null, 2)}
                    </Box>
                  </Collapse>
                </Box>
              ))}
            </List>
          </Box>
        ))}
      </Stack>
    </Shell>
  )
}
