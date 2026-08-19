'use client'

import { Box, Button, Card, CardContent, Stack, Typography } from '@mui/material'

interface AuthErrorProps {
  onRetry: () => void
}

export function AuthError({ onRetry }: AuthErrorProps) {
  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center' }}>
      <Card sx={{ maxWidth: 480 }}>
        <CardContent>
          <Stack spacing={2} sx={{ alignItems: 'center', textAlign: 'center' }}>
            <Typography variant="h6">Something went wrong</Typography>
            <Typography variant="body2">Could not verify sign-in. Check your connection and retry.</Typography>
            <Button variant="outlined" onClick={onRetry}>
              Retry
            </Button>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  )
}
