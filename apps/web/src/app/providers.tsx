'use client'

import { CssBaseline, ThemeProvider } from '@mui/material'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { theme } from '../theme'
import { AuthGate } from '../components/auth-gate'
import { SnackbarProvider } from '../components/snackbar'

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 15_000 } },
})

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <QueryClientProvider client={queryClient}>
        <SnackbarProvider>
          <AuthGate>{children}</AuthGate>
        </SnackbarProvider>
      </QueryClientProvider>
    </ThemeProvider>
  )
}
