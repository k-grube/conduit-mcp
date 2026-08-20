import axios, { type AxiosInstance } from 'axios'
import { InteractionRequiredAuthError } from '@azure/msal-browser'
import { getAuthConfig } from './auth-config'
import { getMsal, portalScope } from './msal'

export type TokenGetter = () => Promise<string>

export function createApi(getToken: TokenGetter, onUnauthorized: () => void): AxiosInstance {
  const client = axios.create()
  client.interceptors.request.use(async (config) => {
    config.headers.Authorization = `Bearer ${await getToken()}`
    return config
  })
  client.interceptors.response.use(undefined, (err) => {
    if (err.response?.status === 401) {
      onUnauthorized()
    }
    return Promise.reject(err)
  })
  return client
}

async function redirectToLogin(): Promise<void> {
  const cfg = await getAuthConfig()
  if (!cfg.configured) {
    return
  }
  const pca = await getMsal(cfg)
  await pca.loginRedirect({ scopes: [portalScope()] })
}

// one-shot guard, a persistent 401 must not loop probe -> redirect -> sso -> probe forever
const LOGIN_REDIRECT_KEY = 'conduit.loginRedirectAttempted'

export function clearLoginRedirectAttempt(): void {
  sessionStorage.removeItem(LOGIN_REDIRECT_KEY)
}

async function msalTokenGetter(): Promise<string> {
  const cfg = await getAuthConfig()
  if (!cfg.configured) {
    throw new Error('auth not configured')
  }
  const pca = await getMsal(cfg)
  const account = pca.getActiveAccount()
  if (!account) {
    await redirectToLogin()
    throw new Error('no active account')
  }
  try {
    const result = await pca.acquireTokenSilent({ scopes: [portalScope()], account })
    return result.accessToken
  } catch (err) {
    if (err instanceof InteractionRequiredAuthError) {
      await redirectToLogin()
    } else if (sessionStorage.getItem(LOGIN_REDIRECT_KEY) !== '1') {
      // wedged msal cache (stale account, iframe timeout): one interactive pass rewrites it,
      // the guard keeps a persistent silent failure from looping through entra
      sessionStorage.setItem(LOGIN_REDIRECT_KEY, '1')
      await redirectToLogin()
    }
    throw err
  }
}

export const api = createApi(msalTokenGetter, () => {
  if (sessionStorage.getItem(LOGIN_REDIRECT_KEY) === '1') {
    return
  }
  sessionStorage.setItem(LOGIN_REDIRECT_KEY, '1')
  void redirectToLogin()
})
