'use client'

import { Box, Button, Card, CardContent, Stack, Typography } from '@mui/material'

interface NotAuthorizedProps {
  username: string | undefined
  onLogout: () => void
}

export function NotAuthorized({ username, onLogout }: NotAuthorizedProps) {
  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center' }}>
      <Card sx={{ maxWidth: 480 }}>
        <CardContent>
          <Stack spacing={2} sx={{ alignItems: 'center', textAlign: 'center' }}>
            <Typography variant="h6">Not authorized</Typography>
            {username && <Typography variant="body2">Signed in as {username}</Typography>}
            <Typography variant="body2">No portal role assigned.</Typography>
            <Button variant="outlined" onClick={onLogout}>
              Log out
            </Button>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  )
}
