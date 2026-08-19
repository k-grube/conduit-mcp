'use client'

import { Fragment, type ReactNode } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { AppBar, Box, Button, Drawer, List, ListItemButton, ListItemText, Toolbar, Typography } from '@mui/material'
import { useAuth } from './auth-gate'

const DRAWER_WIDTH = 220

const NAV_ITEMS = [
  { label: 'Dashboard', href: '/', group: 'Operate' },
  { label: 'Connect', href: '/connect/', group: 'Operate' },
  { label: 'Activity', href: '/activity/', group: 'Operate' },
  { label: 'Tools', href: '/tools/', group: 'Operate' },
  { label: 'Tool Notes', href: '/tool-notes/', group: 'Operate' },
  { label: 'Plugins', href: '/plugins/', group: 'Configure' },
  { label: 'Roles', href: '/roles/', group: 'Configure' },
  { label: 'API Keys', href: '/keys/', group: 'Configure' },
  { label: 'Settings', href: '/settings/', group: 'Configure' },
]

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const { account, logout } = useAuth()

  return (
    <Box sx={{ display: 'flex' }}>
      <AppBar position="fixed">
        <Toolbar sx={{ gap: 2 }}>
          <Box sx={{ width: 16, height: 16, bgcolor: 'primary.main', position: 'relative', top: -1 }} />
          <Typography variant="h6" sx={{ flexGrow: 1 }}>
            Conduit
          </Typography>
          {account && <Typography variant="body2">{account.name ?? account.username}</Typography>}
          <Button color="inherit" onClick={logout}>
            Log out
          </Button>
        </Toolbar>
      </AppBar>
      <Drawer
        variant="permanent"
        sx={{
          width: DRAWER_WIDTH,
          flexShrink: 0,
          // nav paper clips under the bar, temporary drawers (zIndex.drawer) keep stacking above it
          '& .MuiDrawer-paper': { width: DRAWER_WIDTH, zIndex: (theme) => theme.zIndex.appBar - 1 },
        }}
      >
        <Toolbar />
        <List>
          {NAV_ITEMS.map((item, i) => (
            <Fragment key={item.href}>
              {NAV_ITEMS[i - 1]?.group !== item.group && (
                <Typography
                  variant="overline"
                  sx={{ display: 'block', px: 5, pt: i === 0 ? 2 : 6, pb: 1, color: 'text.secondary' }}
                >
                  {item.group}
                </Typography>
              )}
              <ListItemButton component={Link} href={item.href} selected={pathname === item.href}>
                <ListItemText primary={item.label} />
              </ListItemButton>
            </Fragment>
          ))}
        </List>
      </Drawer>
      <Box component="main" sx={{ flexGrow: 1, p: 3 }}>
        <Toolbar />
        {children}
      </Box>
    </Box>
  )
}
