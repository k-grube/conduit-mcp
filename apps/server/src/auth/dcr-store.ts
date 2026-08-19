import type { TableClient } from '@azure/data-tables'
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js'
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js'
import { InvalidClientMetadataError } from '@modelcontextprotocol/sdk/server/auth/errors.js'
import { logEvent } from '../logger.js'
import { ensureTable, getJsonRow } from '../storage/tables.js'

const PARTITION = 'dcr'

export const DEFAULT_REDIRECT_HOSTS = ['claude.ai', 'localhost', '127.0.0.1']

function hostAllowed(hostname: string, allowed: string[]): boolean {
  return allowed.some((a) => hostname === a || hostname.endsWith(`.${a}`))
}

function redirectUriAllowed(uri: string, allowed: string[]): boolean {
  let url: URL
  try {
    url = new URL(uri)
  } catch {
    return false
  }
  const schemeOk =
    url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))
  return schemeOk && hostAllowed(url.hostname, allowed)
}

export class AdtClientsStore implements OAuthRegisteredClientsStore {
  private tableName: string
  private client?: TableClient

  constructor(tableName = 'DcrClients') {
    this.tableName = tableName
  }

  private async table(): Promise<TableClient> {
    if (!this.client) {
      this.client = await ensureTable(this.tableName)
    }
    return this.client
  }

  async getClient(clientId: string): Promise<OAuthClientInformationFull | undefined> {
    const table = await this.table()
    const row = await getJsonRow<OAuthClientInformationFull>(table, PARTITION, clientId)
    if (row?.etag) {
      // conditional touch: a concurrent registerClient wins, 412 skips the refresh
      void table
        .updateEntity({ partitionKey: PARTITION, rowKey: clientId, json: JSON.stringify(row.value) }, 'Replace', {
          etag: row.etag,
        })
        .catch((err) => logEvent('auth', 'dcr_touch_failed', { error: (err as Error).message }))
    }
    return row?.value
  }

  async registerClient(client: OAuthClientInformationFull): Promise<OAuthClientInformationFull> {
    const table = await this.table()
    await table.upsertEntity({ partitionKey: PARTITION, rowKey: client.client_id, json: JSON.stringify(client) })
    return client
  }
}

// dcr is open registration, guard which redirect hosts it will hand a client_id to
export class GuardedClientsStore implements OAuthRegisteredClientsStore {
  constructor(
    private inner: AdtClientsStore,
    private getAllowedHosts: () => string[],
  ) {}

  // stored clients (or ones stored before an allowlist tightening) are re-checked on every lookup,
  // not just at registration, so a narrowed allowlist actually revokes them
  async getClient(clientId: string): Promise<OAuthClientInformationFull | undefined> {
    const client = await this.inner.getClient(clientId)
    if (!client) {
      return undefined
    }
    const allowed = this.getAllowedHosts()
    const stillValid = (client.redirect_uris ?? []).every((uri) => redirectUriAllowed(uri, allowed))
    if (!stillValid) {
      logEvent('auth', 'dcr_client_rejected', { clientId })
      return undefined
    }
    return client
  }

  async registerClient(client: OAuthClientInformationFull): Promise<OAuthClientInformationFull> {
    const allowed = this.getAllowedHosts()
    for (const uri of client.redirect_uris ?? []) {
      let url: URL
      try {
        url = new URL(uri)
      } catch {
        throw new InvalidClientMetadataError(`invalid redirect uri: ${uri}`)
      }
      // allowlist doesn't stop custom schemes (myapp://claude.ai/cb), require https (or http loopback)
      const schemeOk =
        url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))
      if (!schemeOk) {
        throw new InvalidClientMetadataError(`redirect uri scheme not allowed: ${uri}`)
      }
      if (!hostAllowed(url.hostname, allowed)) {
        throw new InvalidClientMetadataError(`redirect uri host not allowed: ${url.hostname}`)
      }
    }
    return this.inner.registerClient(client)
  }
}
