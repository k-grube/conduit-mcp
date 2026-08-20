'use client'

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { IPublicClientApplication } from '@azure/msal-browser'
import { getAuthConfig } from '../lib/auth-config'
import { getMsal } from '../lib/msal'
import { api, clearLoginRedirectAttempt } from '../lib/api'
import { SetupWizard } from './setup-wizard'
import { NotAuthorized } from './not-authorized'
import { AuthError } from './auth-error'

type Account = { name?: string; username: string; oid: string }

type GateState = 'loading' | 'setup-needed' | 'login-redirect' | 'ready' | 'not-authorized' | 'error'

interface AuthContextValue {
  account: Account | undefined
  logout(): void
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthGate')
  }
  return ctx
}

// status only, never the error/config object, config.headers carries the live bearer token
function errorStatus(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null) {
    return undefined
  }
  return (err as { response?: { status?: number } }).response?.status
}

function isForbidden(err: unknown): boolean {
  return errorStatus(err) === 403
}

// msal errors carry a stable errorCode, safe to log (no token material)
function msalErrorCode(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null) {
    return undefined
  }
  const code = (err as { errorCode?: unknown }).errorCode
  return typeof code === 'string' && code.length > 0 ? code : undefined
}

export function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>('loading')
  const [account, setAccount] = useState<Account | undefined>(undefined)
  const [attempt, setAttempt] = useState(0)
  const pcaRef = useRef<IPublicClientApplication | undefined>(undefined)

  useEffect(() => {
    let cancelled = false

    async function run() {
      setState('loading')
      try {
        const cfg = await getAuthConfig()
        if (cancelled) {
          return
        }
        if (!cfg.configured) {
          setState('setup-needed')
          return
        }

        const pca = await getMsal(cfg)
        pcaRef.current = pca

        const redirectResult = await pca.handleRedirectPromise()
        if (redirectResult?.account) {
          pca.setActiveAccount(redirectResult.account)
        }

        const active = pca.getActiveAccount()
        if (!active) {
          if (!cancelled) {
            setState('login-redirect')
          }
          await pca.loginRedirect({ scopes: [cfg.portalScope] })
          return
        }
        if (cancelled) {
          return
        }
        setAccount({ name: active.name, username: active.username, oid: active.localAccountId })

        try {
          await api.get('/api/admin/activity?limit=1')
          if (!cancelled) {
            clearLoginRedirectAttempt()
            setState('ready')
          }
        } catch (err) {
          if (cancelled) {
            return
          }
          if (isForbidden(err)) {
            setState('not-authorized')
            return
          }
          console.error('activity probe failed', errorStatus(err) ?? msalErrorCode(err) ?? 'network')
          setState('error')
        }
      } catch (err) {
        if (cancelled) {
          return
        }
        console.error('auth bootstrap failed', errorStatus(err) ?? msalErrorCode(err) ?? 'network')
        setState('error')
      }
    }

    run()

    return () => {
      cancelled = true
    }
  }, [attempt])

  function logout() {
    pcaRef.current?.logoutRedirect()
  }

  function retry() {
    setAttempt((n) => n + 1)
  }

  if (state === 'setup-needed') {
    return <SetupWizard />
  }
  if (state === 'not-authorized') {
    return <NotAuthorized username={account?.username} onLogout={logout} />
  }
  if (state === 'error') {
    return <AuthError onRetry={retry} />
  }
  if (state !== 'ready') {
    return null
  }

  return <AuthContext.Provider value={{ account, logout }}>{children}</AuthContext.Provider>
}
