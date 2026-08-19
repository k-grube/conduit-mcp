'use client'

import { Box, List, ListItem, ListItemText, Stack, Typography } from '@mui/material'
import { ErrorState } from '../../components/error-state'
import { Shell } from '../../components/shell'
import { useToolNotes, type ToolNote } from '../../lib/queries'

function NoteList({ title, entries }: { title: string; entries: [string, ToolNote][] }) {
  if (entries.length === 0) {
    return null
  }
  return (
    <Box>
      <Typography variant="subtitle2">{title}</Typography>
      <List dense>
        {entries.map(([name, note]) => (
          <ListItem key={name} alignItems="flex-start">
            <ListItemText
              primary={name}
              secondary={
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                  <span>{note.text}</span>
                  <Typography variant="caption">
                    {note.updatedBy}, {note.updatedAt}
                  </Typography>
                </Box>
              }
              slotProps={{ secondary: { component: 'div' } }}
            />
          </ListItem>
        ))}
      </List>
    </Box>
  )
}

export default function Page() {
  const { data, isLoading, isError, refetch } = useToolNotes()
  return (
    <Shell>
      <Stack spacing={2}>
        {isError && <ErrorState onRetry={() => refetch()} />}
        {isLoading && <Typography variant="body2">Loading...</Typography>}
        {data && <NoteList title="Integrations" entries={Object.entries(data.integrations)} />}
        {data && <NoteList title="Tools" entries={Object.entries(data.tools)} />}
        {data && Object.keys(data.tools).length === 0 && Object.keys(data.integrations).length === 0 && (
          <Typography variant="body2">No notes saved</Typography>
        )}
      </Stack>
    </Shell>
  )
}
