import { PublicClientApplication } from '@azure/msal-browser'

let pca: PublicClientApplication | undefined
let scope: string | undefined

export async function getMsal(cfg: { tenantId: string; clientId: string; portalScope: string }) {
  if (!pca) {
    const instance = new PublicClientApplication({
      auth: {
        clientId: cfg.clientId,
        authority: `https://login.microsoftonline.com/${cfg.tenantId}`,
        redirectUri: typeof window === 'undefined' ? '/' : window.location.origin,
      },
      cache: { cacheLocation: 'sessionStorage' },
    })
    // don't publish the singleton until init succeeds, a failed init must not wedge retries on a broken instance
    await instance.initialize()
    pca = instance
    scope = cfg.portalScope
  }
  return pca
}

export function portalScope(): string {
  if (!scope) {
    throw new Error('msal not initialized')
  }
  return scope
}
