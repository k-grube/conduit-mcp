import { OAuthCcClient, assertEgressUrl, type PluginContext } from '@conduit-mcp/plugin-sdk'

// ninja returns pagination cursors as {name, offset, count, expires}; every tool
// expects the plain string cursor.name, so flatten it once at the request boundary
function flattenCursor(data: unknown): unknown {
  if (!data || typeof data !== 'object' || !('cursor' in data)) {
    return data
  }
  const d = data as Record<string, unknown>
  const cursor = d.cursor
  if (cursor && typeof cursor === 'object' && 'name' in (cursor as Record<string, unknown>)) {
    return { ...d, cursor: (cursor as Record<string, unknown>).name }
  }
  return data
}

export class NinjaClient {
  readonly baseUrl: string
  private oauth: OAuthCcClient
  private fetchFn: typeof fetch

  constructor(opts: {
    baseUrl: string
    clientId: string
    clientSecret: string
    scope: string
    fetchFn?: typeof fetch
  }) {
    this.baseUrl = assertEgressUrl(opts.baseUrl)
    this.fetchFn = opts.fetchFn ?? fetch
    this.oauth = new OAuthCcClient({
      tokenUrl: `${this.baseUrl}/ws/oauth/token`,
      clientId: opts.clientId,
      clientSecret: opts.clientSecret,
      scope: opts.scope,
      fetchFn: this.fetchFn,
    })
  }

  // healthCheck hook, confirms the client credentials actually mint a token
  async verifyAuth(): Promise<void> {
    await this.oauth.getToken()
  }

  private async request<T = unknown>(path: string, params?: Record<string, unknown>): Promise<T> {
    const url = new URL(`${this.baseUrl}/api/v2${path}`)
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value))
        }
      }
    }
    const data = await this.oauth.request<unknown>(url.toString())
    return flattenCursor(data) as T
  }

  // Organizations
  async getOrganizations(params?: Record<string, unknown>): Promise<unknown> {
    return this.request('/organizations-detailed', params)
  }

  async getOrganizationById(id: number): Promise<unknown> {
    return this.request(`/organization/${id}`)
  }

  async getOrganizationDevices(id: number, params?: Record<string, unknown>): Promise<unknown> {
    return this.request(`/organization/${id}/devices`, params)
  }

  // Devices
  async getDevices(params?: Record<string, unknown>): Promise<unknown> {
    return this.request('/devices-detailed', params)
  }

  async getDeviceById(id: number): Promise<unknown> {
    return this.request(`/device/${id}`)
  }

  async searchDevices(query: string, limit?: number): Promise<unknown> {
    return this.request('/devices/search', { q: query, limit: limit || 10 })
  }

  async getDeviceSoftware(id: number): Promise<unknown> {
    return this.request(`/device/${id}/software`)
  }

  async getDeviceAlerts(id: number): Promise<unknown> {
    return this.request(`/device/${id}/alerts`)
  }

  async getDeviceDisks(id: number): Promise<unknown> {
    return this.request(`/device/${id}/disks`)
  }

  async getDeviceNetworkInterfaces(id: number): Promise<unknown> {
    return this.request(`/device/${id}/network-interfaces`)
  }

  async getDeviceOsPatches(id: number, params?: Record<string, unknown>): Promise<unknown> {
    return this.request(`/device/${id}/os-patches`, params)
  }

  async getDeviceCustomFields(id: number): Promise<unknown> {
    return this.request(`/device/${id}/custom-fields`, { withInheritance: true })
  }

  async getOrganizationCustomFields(id: number): Promise<unknown> {
    return this.request(`/organization/${id}/custom-fields`)
  }

  // Custom field definitions (what fields exist)
  async getCustomFieldDefinitions(params?: Record<string, unknown>): Promise<unknown> {
    return this.request('/device-custom-fields', params)
  }

  // Query custom fields across all devices (with pagination)
  async queryCustomFields(params?: Record<string, unknown>): Promise<unknown> {
    return this.request('/queries/custom-fields-detailed', params)
  }

  // Scoped custom fields (filter by device/org/location scope)
  async queryScopedCustomFields(params?: Record<string, unknown>): Promise<unknown> {
    return this.request('/queries/scoped-custom-fields-detailed', params)
  }

  async getDeviceWindowsServices(id: number, params?: Record<string, unknown>): Promise<unknown> {
    return this.request(`/device/${id}/windows-services`, params)
  }

  // Per-device troubleshooting
  async getDeviceActivities(id: number, params?: Record<string, unknown>): Promise<unknown> {
    return this.request(`/device/${id}/activities`, params)
  }

  async getDeviceJobs(id: number): Promise<unknown> {
    return this.request(`/device/${id}/jobs`)
  }

  async getDeviceLastLoggedOnUser(id: number): Promise<unknown> {
    return this.request(`/device/${id}/last-logged-on-user`)
  }

  async getDeviceOsPatchInstalls(id: number, params?: Record<string, unknown>): Promise<unknown> {
    return this.request(`/device/${id}/os-patch-installs`, params)
  }

  async getDeviceSoftwarePatchInstalls(id: number, params?: Record<string, unknown>): Promise<unknown> {
    return this.request(`/device/${id}/software-patch-installs`, params)
  }

  async getDeviceSoftwarePatches(id: number, params?: Record<string, unknown>): Promise<unknown> {
    return this.request(`/device/${id}/software-patches`, params)
  }

  async getDeviceVolumes(id: number): Promise<unknown> {
    return this.request(`/device/${id}/volumes`)
  }

  async getDeviceProcessors(id: number): Promise<unknown> {
    return this.request(`/device/${id}/processors`)
  }

  // Fleet queries, troubleshooting
  async queryLoggedOnUsers(params?: Record<string, unknown>): Promise<unknown> {
    return this.request('/queries/logged-on-users', params)
  }

  async queryAntivirusThreats(params?: Record<string, unknown>): Promise<unknown> {
    return this.request('/queries/antivirus-threats', params)
  }

  async queryComputerSystems(params?: Record<string, unknown>): Promise<unknown> {
    return this.request('/queries/computer-systems', params)
  }

  async queryOsPatchInstalls(params?: Record<string, unknown>): Promise<unknown> {
    return this.request('/queries/os-patch-installs', params)
  }

  async queryVolumes(params?: Record<string, unknown>): Promise<unknown> {
    return this.request('/queries/volumes', params)
  }

  async queryOperatingSystems(params?: Record<string, unknown>): Promise<unknown> {
    return this.request('/queries/operating-systems', params)
  }

  // Alerts
  async getAlerts(params?: Record<string, unknown>): Promise<unknown> {
    return this.request('/alerts', params)
  }

  // Activities
  async getActivities(params?: Record<string, unknown>): Promise<unknown> {
    return this.request('/activities', params)
  }

  // Group members
  async getGroupDeviceIds(groupId: number): Promise<unknown> {
    return this.request(`/group/${groupId}/device-ids`)
  }

  // Groups & Policies
  async getGroups(): Promise<unknown> {
    return this.request('/groups')
  }

  async getPolicies(): Promise<unknown> {
    return this.request('/policies')
  }

  // Queries (reporting endpoints)
  async querySoftware(params?: Record<string, unknown>): Promise<unknown> {
    return this.request('/queries/software', params)
  }

  async queryAntivirusStatus(params?: Record<string, unknown>): Promise<unknown> {
    return this.request('/queries/antivirus-status', params)
  }

  async queryDeviceHealth(params?: Record<string, unknown>): Promise<unknown> {
    return this.request('/queries/device-health', params)
  }

  async queryOsPatches(params?: Record<string, unknown>): Promise<unknown> {
    return this.request('/queries/os-patches', params)
  }

  // Scripts
  async getScripts(params?: Record<string, unknown>): Promise<unknown> {
    return this.request('/automation/scripts', params)
  }
}

// single config per plugin, module-scope holder cached across tool calls
let cached: NinjaClient | undefined

export async function getClient(ctx: PluginContext, fetchFn?: typeof fetch): Promise<NinjaClient> {
  if (!cached) {
    const cfg = await ctx.getConfig<{ baseUrl?: string; clientId?: string; oauthScope?: string }>()
    if (!cfg.baseUrl || !cfg.clientId) {
      throw new Error('missing required ninja setting: baseUrl or clientId')
    }
    const clientSecret = await ctx.getSecret('NINJA_CLIENT_SECRET')
    cached = new NinjaClient({
      baseUrl: cfg.baseUrl,
      clientId: cfg.clientId,
      clientSecret,
      // oauthScope optional, default to monitoring-only access
      scope: cfg.oauthScope || 'monitoring',
      fetchFn,
    })
  }
  return cached
}

export function resetClient(): void {
  cached = undefined
}
