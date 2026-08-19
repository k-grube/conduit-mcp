import { defineTool, trimResponse, z, type ToolDef } from '@conduit-mcp/plugin-sdk'
import { getClient } from '../client.js'
import { formatResult } from '../format.js'
import { ninjaDeviceUrl } from '../urls.js'
import { DF_DESCRIPTION } from '../filters.js'

const LIST_DEVICES_DESCRIPTION =
  'List NinjaRMM devices with detailed information. Supports device filter expressions. Response wraps the array with page_cap_reached + next_after when the returned count equals the requested pageSize; use the df filter to narrow or pass next_after back as `after` to continue. Do NOT blindly paginate across thousands of devices, narrow the filter first.'

interface NinjaDevice {
  id: number
  systemName?: string
  displayName?: string
  organizationId?: number
  nodeClass?: string
  offline?: boolean
  maintenance?: {
    status?: string
    start?: number
    end?: number
    reasonMessage?: string
  }
}

interface NinjaOrganization {
  id: number
  name?: string
}

export function wrapDeviceListPayload(
  result: unknown,
  requestedPageSize: number,
  client: { baseUrl: string },
): unknown {
  const items = (Array.isArray(result) ? result : []) as Record<string, unknown>[]
  const withUrls: Record<string, unknown>[] = items.map((item) => ninjaDeviceUrl(item, client))
  const pageCapReached = withUrls.length >= requestedPageSize && withUrls.length > 0
  const lastId = withUrls.length > 0 ? Number(withUrls[withUrls.length - 1]['id']) : null
  return {
    returned: withUrls.length,
    requested_page_size: requestedPageSize,
    page_cap_reached: pageCapReached,
    next_after: pageCapReached ? lastId : null,
    ...(pageCapReached && {
      hint: 'Exactly pageSize rows returned, likely more results. Narrow with df, or call again with after=next_after. Do not blindly paginate thousands of devices.',
    }),
    devices: withUrls,
  }
}

export interface MaintenanceDevicesClient {
  baseUrl: string
  getOrganizations(params?: Record<string, unknown>): Promise<unknown>
  getDevices(params?: Record<string, unknown>): Promise<unknown>
}

export interface MaintenanceDevicesArgs {
  openEndedOnly?: boolean
  organizationName?: string
  nodeClass?: string
}

// pages the fleet server-side in 1000-row chunks, keeping only devices in maintenance
export async function listMaintenanceDevices(
  client: MaintenanceDevicesClient,
  { openEndedOnly, organizationName, nodeClass }: MaintenanceDevicesArgs,
): Promise<unknown> {
  const orgsResult = await client.getOrganizations({ pageSize: 1000 })
  const orgList: NinjaOrganization[] = Array.isArray(orgsResult) ? orgsResult : []
  const orgMap = new Map(orgList.map((o) => [o.id, o.name ?? `Org ${o.id}`]))

  let allowedOrgIds: Set<number> | null = null
  if (organizationName) {
    const needle = organizationName.toLowerCase()
    allowedOrgIds = new Set(orgList.filter((o) => (o.name ?? '').toLowerCase().includes(needle)).map((o) => o.id))
    if (allowedOrgIds.size === 0) {
      return `No organization found matching "${organizationName}". Use ninja_list_organizations to see available names.`
    }
  }

  const nodeClassFilter = nodeClass?.toUpperCase()

  const maintenanceDevices: Array<{
    id: number
    systemName: string
    organization: string
    nodeClass: string
    offline: boolean
    maintenanceStart: string
    maintenanceEnd: string | null
    reasonMessage: string
    url: string
  }> = []

  let after: number | undefined
  let hasMore = true

  while (hasMore) {
    const params: Record<string, unknown> = { pageSize: 1000 }
    if (after !== undefined) {
      params.after = after
    }

    const result = await client.getDevices(params)
    const items: NinjaDevice[] = Array.isArray(result) ? result : ((result as { items?: NinjaDevice[] })?.items ?? [])

    for (const device of items) {
      if (device.maintenance?.status === 'IN_MAINTENANCE') {
        const hasEnd = device.maintenance.end != null && device.maintenance.end > 0
        if (openEndedOnly && hasEnd) {
          continue
        }
        if (allowedOrgIds && !allowedOrgIds.has(device.organizationId ?? 0)) {
          continue
        }
        if (nodeClassFilter && device.nodeClass !== nodeClassFilter) {
          continue
        }

        maintenanceDevices.push({
          id: device.id,
          systemName: device.systemName ?? device.displayName ?? `Device ${device.id}`,
          organization: orgMap.get(device.organizationId ?? 0) ?? 'Unknown',
          nodeClass: device.nodeClass ?? 'UNKNOWN',
          offline: device.offline ?? false,
          maintenanceStart: device.maintenance.start
            ? new Date(device.maintenance.start * 1000).toISOString()
            : 'unknown',
          maintenanceEnd: hasEnd ? new Date(device.maintenance.end! * 1000).toISOString() : null,
          reasonMessage: device.maintenance.reasonMessage || '',
          url: `${client.baseUrl}/#/deviceDashboard/${device.id}/overview`,
        })
      }
    }

    if (items.length < 1000) {
      hasMore = false
    } else {
      after = items[items.length - 1].id
    }
  }

  return { count: maintenanceDevices.length, devices: maintenanceDevices }
}

export const deviceTools: ToolDef[] = [
  defineTool({
    name: 'ninja_list_devices',
    description: LIST_DEVICES_DESCRIPTION,
    keywords: ['ninja', 'devices', 'list', 'fleet', 'endpoints', 'inventory', 'rmm'],
    params: {
      df: z.string().optional().describe(DF_DESCRIPTION),
      pageSize: z.number().optional().default(50).describe('Results per page'),
      after: z.number().optional().describe('Last device ID for pagination'),
    },
    readOnly: true,
    handler: async (params, ctx) => {
      const client = await getClient(ctx)
      const pageSize = params.pageSize ?? 50
      const result = await client.getDevices({ ...params, pageSize })
      return trimResponse(wrapDeviceListPayload(result, pageSize, client))
    },
  }),

  defineTool({
    name: 'ninja_get_device',
    description: 'Get detailed information about a specific NinjaRMM device by ID.',
    keywords: ['ninja', 'device', 'get', 'detail'],
    params: { id: z.number().describe('The device ID') },
    readOnly: true,
    handler: async ({ id }, ctx) => {
      const client = await getClient(ctx)
      const result = await client.getDeviceById(id)
      return formatResult(result, client, { transformItem: ninjaDeviceUrl })
    },
  }),

  defineTool({
    name: 'ninja_search_devices',
    description:
      'Search NinjaRMM devices by name, logged-on user name, or IP address. Returns {returned, devices} with matching device records. Use to resolve a device name to its numeric ID; for filter expressions use ninja_list_devices with df.',
    keywords: ['ninja', 'devices', 'search', 'find', 'hostname', 'lookup', 'ip address'],
    params: {
      query: z.string().describe('Search text (device name, logged-on user name, IP address)'),
      limit: z.number().optional().default(10).describe('Max results to return'),
    },
    readOnly: true,
    handler: async ({ query, limit }, ctx) => {
      const client = await getClient(ctx)
      const result = await client.searchDevices(query, limit)
      // api wraps matches as {query, devices}, transform each device not the envelope
      return formatResult(result, client, { collectionKey: 'devices', transformItem: ninjaDeviceUrl })
    },
  }),

  defineTool({
    name: 'ninja_get_device_software',
    description:
      'List software installed on one device: name, version, publisher, installDate, size, location per application. For fleet-wide software search use ninja_query_software.',
    keywords: ['ninja', 'device', 'software', 'inventory', 'applications', 'programs'],
    params: { id: z.number().describe('The device ID') },
    readOnly: true,
    handler: async ({ id }, ctx) => {
      const client = await getClient(ctx)
      const result = await client.getDeviceSoftware(id)
      return formatResult(result, client, {
        fields: ['name', 'version', 'publisher', 'installDate', 'size', 'location'],
      })
    },
  }),

  defineTool({
    name: 'ninja_get_device_disks',
    description:
      'Get physical disk drive information for one NinjaRMM device. For logical volumes and free space use ninja_get_device_volumes.',
    keywords: ['ninja', 'device', 'disks', 'storage', 'drives'],
    params: { id: z.number().describe('The device ID') },
    readOnly: true,
    handler: async ({ id }, ctx) => {
      const client = await getClient(ctx)
      const result = await client.getDeviceDisks(id)
      return formatResult(result, client)
    },
  }),

  defineTool({
    name: 'ninja_get_device_network',
    description: 'Get network interface details for one NinjaRMM device (adapters, MAC and IP addresses).',
    keywords: ['ninja', 'device', 'network', 'interfaces', 'ip address', 'mac address', 'nic'],
    params: { id: z.number().describe('The device ID') },
    readOnly: true,
    handler: async ({ id }, ctx) => {
      const client = await getClient(ctx)
      const result = await client.getDeviceNetworkInterfaces(id)
      return formatResult(result, client)
    },
  }),

  defineTool({
    name: 'ninja_get_device_os_patches',
    description:
      'Get OS patch status for one device: pending, approved, rejected, and failed patches with KB number, severity, and type. For install history use ninja_get_device_patch_installs; for fleet-wide status use ninja_query_os_patches.',
    keywords: ['ninja', 'device', 'os patches', 'updates', 'windows updates', 'patch status'],
    params: {
      id: z.number().describe('The device ID'),
      status: z.string().optional().describe('Filter by patch status (e.g. MANUAL, APPROVED, FAILED, REJECTED)'),
    },
    readOnly: true,
    handler: async ({ id, ...rest }, ctx) => {
      const client = await getClient(ctx)
      const result = await client.getDeviceOsPatches(id, rest)
      return formatResult(result, client, {
        fields: ['name', 'kbNumber', 'status', 'severity', 'type', 'installedAt'],
      })
    },
  }),

  defineTool({
    name: 'ninja_get_device_windows_services',
    description: 'List Windows services and their status on a specific NinjaRMM device.',
    keywords: ['ninja', 'device', 'windows services'],
    params: {
      id: z.number().describe('The device ID'),
      name: z.string().optional().describe('Filter by service name'),
      state: z.string().optional().describe("Filter by state (e.g., 'RUNNING', 'STOPPED')"),
    },
    readOnly: true,
    handler: async ({ id, ...rest }, ctx) => {
      const client = await getClient(ctx)
      const result = await client.getDeviceWindowsServices(id, rest)
      return formatResult(result, client, { fields: ['displayName', 'name', 'state', 'startType'] })
    },
  }),

  defineTool({
    name: 'ninja_get_device_custom_fields',
    description: 'Get custom field values for a specific NinjaRMM device, including inherited fields.',
    keywords: ['ninja', 'device', 'custom fields'],
    params: { id: z.number().describe('The device ID') },
    readOnly: true,
    handler: async ({ id }, ctx) => {
      const client = await getClient(ctx)
      const result = await client.getDeviceCustomFields(id)
      return formatResult(result, client)
    },
  }),

  defineTool({
    name: 'ninja_get_device_activities',
    description:
      'Get recent activity history for one device: login events, script runs, patch events, policy changes, errors. Filter with activityType and status.',
    keywords: ['ninja', 'device', 'activities', 'history', 'logs', 'troubleshooting'],
    params: {
      id: z.number().describe('The device ID'),
      activityType: z.string().optional().describe('Filter by activity type'),
      status: z.string().optional().describe('Filter by status'),
      pageSize: z.number().optional().default(25).describe('Results per page'),
    },
    readOnly: true,
    handler: async ({ id, ...rest }, ctx) => {
      const client = await getClient(ctx)
      const result = await client.getDeviceActivities(id, rest)
      return formatResult(result, client)
    },
  }),

  defineTool({
    name: 'ninja_get_device_alerts',
    description: 'Get active alerts and triggered conditions for a specific device.',
    keywords: ['ninja', 'device', 'alerts'],
    params: { id: z.number().describe('The device ID') },
    readOnly: true,
    handler: async ({ id }, ctx) => {
      const client = await getClient(ctx)
      const result = await client.getDeviceAlerts(id)
      return formatResult(result, client)
    },
  }),

  defineTool({
    name: 'ninja_get_device_jobs',
    description: 'Get currently running jobs (scripts, patches, scans) on a specific device.',
    keywords: ['ninja', 'device', 'jobs'],
    params: { id: z.number().describe('The device ID') },
    readOnly: true,
    handler: async ({ id }, ctx) => {
      const client = await getClient(ctx)
      const result = await client.getDeviceJobs(id)
      return formatResult(result, client)
    },
  }),

  defineTool({
    name: 'ninja_get_device_last_user',
    description:
      'Get the last logged-on user (userName, logonTime) for one device. For all devices at once use ninja_query_logged_on_users.',
    keywords: ['ninja', 'device', 'last user', 'logged on'],
    params: { id: z.number().describe('The device ID') },
    readOnly: true,
    handler: async ({ id }, ctx) => {
      const client = await getClient(ctx)
      const result = await client.getDeviceLastLoggedOnUser(id)
      return formatResult(result, client)
    },
  }),

  defineTool({
    name: 'ninja_get_device_patch_installs',
    description:
      'Get OS patch install history for one device: install attempts with patch name, KB number, and status (INSTALLED or FAILED). For pending patch status use ninja_get_device_os_patches; fleet-wide history is ninja_query_os_patch_installs.',
    keywords: ['ninja', 'device', 'patch installs', 'history', 'patch history'],
    params: {
      id: z.number().describe('The device ID'),
      status: z.string().optional().describe('Filter by status (INSTALLED or FAILED)'),
      installedBefore: z.string().optional().describe('Only patches installed before this ISO date'),
      installedAfter: z.string().optional().describe('Only patches installed after this ISO date'),
    },
    readOnly: true,
    handler: async ({ id, ...rest }, ctx) => {
      const client = await getClient(ctx)
      const result = await client.getDeviceOsPatchInstalls(id, rest)
      return formatResult(result, client, {
        fields: ['name', 'kbNumber', 'status', 'severity', 'type', 'installedAt'],
      })
    },
  }),

  defineTool({
    name: 'ninja_get_device_software_patches',
    description: 'Get pending, failed, and rejected third-party software patches for a device.',
    keywords: ['ninja', 'device', 'software patches'],
    params: {
      id: z.number().describe('The device ID'),
      status: z.string().optional().describe("Filter by status (e.g., 'APPROVED', 'FAILED')"),
      type: z.string().optional().describe('Filter by patch type'),
      impact: z.string().optional().describe('Filter by impact level'),
    },
    readOnly: true,
    handler: async ({ id, ...rest }, ctx) => {
      const client = await getClient(ctx)
      const result = await client.getDeviceSoftwarePatches(id, rest)
      return formatResult(result, client, { fields: ['title', 'status', 'type', 'impact'] })
    },
  }),

  defineTool({
    name: 'ninja_get_device_volumes',
    description: 'Get storage volume details for a specific device (partitions, free space, file system).',
    keywords: ['ninja', 'device', 'volumes', 'storage'],
    params: { id: z.number().describe('The device ID') },
    readOnly: true,
    handler: async ({ id }, ctx) => {
      const client = await getClient(ctx)
      const result = await client.getDeviceVolumes(id)
      return formatResult(result, client)
    },
  }),

  defineTool({
    name: 'ninja_get_device_processors',
    description: 'Get CPU/processor information for a specific device.',
    keywords: ['ninja', 'device', 'processors', 'cpu'],
    params: { id: z.number().describe('The device ID') },
    readOnly: true,
    handler: async ({ id }, ctx) => {
      const client = await getClient(ctx)
      const result = await client.getDeviceProcessors(id)
      return formatResult(result, client)
    },
  }),

  defineTool({
    name: 'ninja_list_maintenance_devices',
    description:
      'List NinjaRMM devices currently in maintenance mode. Scans the whole fleet in 1000-row pages and filters client-side, so it can be slow on large fleets. Returns count plus per-device org, nodeClass, maintenance start/end, and reason. Use openEndedOnly to audit windows with no end date.',
    keywords: ['ninja', 'devices', 'maintenance', 'audit', 'maintenance mode', 'maintenance window'],
    params: {
      openEndedOnly: z
        .boolean()
        .optional()
        .default(false)
        .describe('Only return devices without a maintenance end date'),
      organizationName: z.string().optional().describe('Filter by organization name (case-insensitive partial match)'),
      nodeClass: z
        .string()
        .optional()
        .describe(
          'Filter by device type (e.g. "WINDOWS_SERVER", "WINDOWS_WORKSTATION", "HYPERV_VMM_HOST", "HYPERV_VMM_GUEST", "LINUX_SERVER")',
        ),
    },
    readOnly: true,
    handler: async (args, ctx) => {
      const client = await getClient(ctx)
      return listMaintenanceDevices(client, args)
    },
  }),

  defineTool({
    name: 'ninja_get_group_device_ids',
    description:
      'Get the list of device IDs that belong to a specific NinjaRMM group. Use ninja_list_groups first to find the group ID, then use this to get the member device IDs.',
    keywords: ['ninja', 'group', 'device ids'],
    params: { id: z.number().describe('The group ID') },
    readOnly: true,
    handler: async ({ id }, ctx) => {
      const client = await getClient(ctx)
      const result = await client.getGroupDeviceIds(id)
      return formatResult(result, client)
    },
  }),
]
