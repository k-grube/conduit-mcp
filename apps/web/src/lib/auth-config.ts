export type AuthConfig =
  { configured: false } | { configured: true; tenantId: string; clientId: string; portalScope: string }

let cached: Promise<AuthConfig> | undefined

// pre-msal fetch, no token attached, endpoint is open
export function getAuthConfig(): Promise<AuthConfig> {
  if (!cached) {
    cached = fetch('/api/admin/auth-config')
      .then((res) => res.json())
      .catch((err) => {
        // only memoize success, a rejected fetch must not poison retries
        cached = undefined
        throw err
      })
  }
  return cached
}
