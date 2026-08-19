import type { SecretProvider } from '../secrets/provider.js'

export interface GraphPrincipalHit {
  id: string
  displayName: string
  userPrincipalName?: string
}

interface RawHit {
  id: string
  displayName: string
  userPrincipalName?: string
}

export class GraphClient {
  private cfg: { tenantId: string; clientId: string }
  private secrets: SecretProvider
  private fetchFn: typeof fetch
  private token?: { value: string; expiresAt: number }

  constructor(cfg: { tenantId: string; clientId: string }, secrets: SecretProvider, fetchFn: typeof fetch = fetch) {
    this.cfg = cfg
    this.secrets = secrets
    this.fetchFn = fetchFn
  }

  private async getToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now()) {
      return this.token.value
    }
    const secret = await this.secrets.getSecret('AZURE_CLIENT_SECRET')
    const res = await this.fetchFn(`https://login.microsoftonline.com/${this.cfg.tenantId}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.cfg.clientId,
        client_secret: secret,
        scope: 'https://graph.microsoft.com/.default',
      }),
    })
    if (!res.ok) {
      throw new Error(`graph token request failed: ${res.status}`)
    }
    const body = (await res.json()) as { access_token: string; expires_in: number }
    this.token = { value: body.access_token, expiresAt: Date.now() + (body.expires_in - 60) * 1000 }
    return this.token.value
  }

  private async search(path: string, filter: string, select: string): Promise<GraphPrincipalHit[]> {
    const token = await this.getToken()
    const params = `$filter=${encodeURIComponent(filter)}&$select=${select}&$top=20`
    const url = `https://graph.microsoft.com/v1.0/${path}?${params}`
    const res = await this.fetchFn(url, { headers: { authorization: `Bearer ${token}` } })
    if (!res.ok) {
      throw new Error(`graph search failed: ${res.status}`)
    }
    const body = (await res.json()) as { value: RawHit[] }
    return body.value.map((h) => ({
      id: h.id,
      displayName: h.displayName,
      ...(h.userPrincipalName ? { userPrincipalName: h.userPrincipalName } : {}),
    }))
  }

  async searchUsers(q: string): Promise<GraphPrincipalHit[]> {
    const safe = q.replaceAll("'", "''")
    return this.search(
      'users',
      `startswith(displayName,'${safe}') or startswith(userPrincipalName,'${safe}')`,
      'id,displayName,userPrincipalName',
    )
  }

  async searchGroups(q: string): Promise<GraphPrincipalHit[]> {
    const safe = q.replaceAll("'", "''")
    return this.search('groups', `startswith(displayName,'${safe}')`, 'id,displayName')
  }
}
