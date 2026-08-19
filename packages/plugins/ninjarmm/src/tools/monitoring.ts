import { defineTool, z, type ToolDef } from '@conduit-mcp/plugin-sdk'
import { getClient } from '../client.js'
import { formatResult } from '../format.js'
import { DF_DESCRIPTION } from '../filters.js'
import { queryNinjaSoftware } from '../software.js'

export const monitoringTools: ToolDef[] = [
  defineTool({
    name: 'ninja_list_alerts',
    description: 'List active alerts/triggered conditions across all NinjaRMM devices.',
    keywords: ['ninja', 'alerts', 'list', 'monitoring'],
    params: {
      sourceType: z.string().optional().describe('Filter by source type'),
      df: z.string().optional().describe(DF_DESCRIPTION),
    },
    readOnly: true,
    handler: async (params, ctx) => {
      const client = await getClient(ctx)
      const result = await client.getAlerts(params)
      return formatResult(result, client)
    },
  }),

  defineTool({
    name: 'ninja_list_activities',
    description: 'List recent NinjaRMM activities across all devices. Supports filtering by type and status.',
    keywords: ['ninja', 'activities', 'list', 'history', 'audit', 'events', 'log'],
    params: {
      class: z.string().optional().describe('Activity class filter: SYSTEM, DEVICE, USER, or ALL'),
      type: z.string().optional().describe('Activity type filter'),
      status: z.string().optional().describe('Status filter'),
      df: z.string().optional().describe(DF_DESCRIPTION),
      pageSize: z.number().optional().default(50).describe('Results per page'),
    },
    readOnly: true,
    handler: async (params, ctx) => {
      const client = await getClient(ctx)
      const result = await client.getActivities(params)
      return formatResult(result, client)
    },
  }),

  defineTool({
    name: 'ninja_query_device_health',
    description:
      'Query health across all NinjaRMM devices: one row per device with healthStatus plus counts of active threats, failed and pending patches, alerts, and vulnerabilities. Filter with health or df.',
    keywords: ['ninja', 'query', 'device health', 'unhealthy', 'issues'],
    params: {
      df: z.string().optional().describe(DF_DESCRIPTION),
      health: z.string().optional().describe("Filter by health status (e.g., 'HEALTHY', 'NEEDS_ATTENTION')"),
      pageSize: z.number().optional().default(25).describe('Results per page'),
      cursor: z.string().optional().describe('Pagination cursor from previous response'),
    },
    readOnly: true,
    handler: async (params, ctx) => {
      const client = await getClient(ctx)
      const result = await client.queryDeviceHealth(params)
      return formatResult(result, client, { collectionKey: 'results' })
    },
  }),

  defineTool({
    name: 'ninja_query_antivirus_status',
    description:
      'Query antivirus status across all NinjaRMM devices: AV product name, product state, and definition status per device. For detected threats use ninja_query_antivirus_threats.',
    keywords: ['ninja', 'query', 'antivirus', 'status', 'av', 'defender', 'definitions'],
    params: {
      df: z.string().optional().describe(DF_DESCRIPTION),
      productName: z.string().optional().describe('Filter by AV product name'),
      pageSize: z.number().optional().default(25).describe('Results per page'),
      cursor: z.string().optional().describe('Pagination cursor'),
    },
    readOnly: true,
    handler: async (params, ctx) => {
      const client = await getClient(ctx)
      const result = await client.queryAntivirusStatus(params)
      return formatResult(result, client, { collectionKey: 'results' })
    },
  }),

  defineTool({
    name: 'ninja_query_os_patches',
    description:
      'Query OS patch status across all NinjaRMM devices: one row per device and patch with status, severity, type, and KB number. Use for finding devices missing patches or failed patches fleet-wide; for one device use ninja_get_device_os_patches, for install history use ninja_query_os_patch_installs.',
    keywords: ['ninja', 'query', 'os patches', 'missing patches', 'patch compliance', 'windows updates', 'patching'],
    params: {
      df: z.string().optional().describe(DF_DESCRIPTION),
      status: z.string().optional().describe('Filter by patch status (e.g. MANUAL, APPROVED, FAILED, REJECTED)'),
      severity: z.string().optional().describe('Filter by severity (e.g. CRITICAL, IMPORTANT, MODERATE, LOW)'),
      pageSize: z.number().optional().default(25).describe('Results per page'),
      cursor: z.string().optional().describe('Pagination cursor'),
    },
    readOnly: true,
    handler: async (params, ctx) => {
      const client = await getClient(ctx)
      const result = await client.queryOsPatches(params)
      return formatResult(result, client, { collectionKey: 'results' })
    },
  }),

  defineTool({
    name: 'ninja_query_software',
    description:
      'Query software inventory across NinjaRMM devices. Provide name to search for specific software (e.g. "TeamViewer"). The API has no server-side name filter, so name search scans the inventory client-side; for a complete single-call result scope with df (e.g. df="org = 5" or "id = 1234"), otherwise a continuation cursor is returned to resume fleet-wide scans. Without name, one raw inventory page is returned per call.',
    keywords: ['ninja', 'query', 'software', 'inventory', 'applications', 'installed'],
    params: {
      df: z.string().optional().describe(DF_DESCRIPTION),
      name: z.string().optional().describe('Filter by software name (case-insensitive partial match), RECOMMENDED'),
      installedBefore: z.string().optional().describe('Include software installed before this date'),
      installedAfter: z.string().optional().describe('Include software installed after this date'),
      pageSize: z
        .number()
        .optional()
        .default(1000)
        .describe('Rows fetched per API page (name scans raise values under 500 to 1000)'),
      cursor: z.string().optional().describe('Pagination cursor'),
    },
    readOnly: true,
    handler: async (params, ctx) => {
      const client = await getClient(ctx)
      return queryNinjaSoftware(client, params)
    },
  }),

  defineTool({
    name: 'ninja_list_groups',
    description: 'List all NinjaRMM device groups (saved searches).',
    keywords: ['ninja', 'groups', 'list', 'saved searches'],
    params: {},
    readOnly: true,
    handler: async (_params, ctx) => {
      const client = await getClient(ctx)
      const result = await client.getGroups()
      return formatResult(result, client)
    },
  }),

  defineTool({
    name: 'ninja_list_scripts',
    description:
      'List all available automation scripts in NinjaRMM. Returns script ID, name, description, language, and parameters.',
    keywords: ['ninja', 'scripts', 'automation', 'list'],
    params: {
      lang: z.string().optional().describe('Filter by script language'),
    },
    readOnly: true,
    handler: async (params, ctx) => {
      const client = await getClient(ctx)
      const result = await client.getScripts(params)
      return formatResult(result, client)
    },
  }),

  defineTool({
    name: 'ninja_query_logged_on_users',
    description:
      'Query last logged-on user (userName, logonTime) across all devices. Use to find which user is on which machine; for one device use ninja_get_device_last_user.',
    keywords: ['ninja', 'query', 'logged on users', 'who is logged in', 'last user', 'username'],
    params: {
      df: z.string().optional().describe(DF_DESCRIPTION),
      pageSize: z.number().optional().default(25).describe('Results per page'),
      cursor: z.string().optional().describe('Pagination cursor'),
    },
    readOnly: true,
    handler: async (params, ctx) => {
      const client = await getClient(ctx)
      const result = await client.queryLoggedOnUsers(params)
      return formatResult(result, client, { collectionKey: 'results' })
    },
  }),

  defineTool({
    name: 'ninja_query_antivirus_threats',
    description:
      'Query antivirus threats across all devices and endpoints: detected malware with threat name, category, status, quarantine state, and affected device ID.',
    keywords: ['ninja', 'query', 'antivirus', 'threats', 'malware', 'endpoints', 'quarantine', 'security'],
    params: {
      df: z.string().optional().describe(DF_DESCRIPTION),
      pageSize: z.number().optional().default(25).describe('Results per page'),
      cursor: z.string().optional().describe('Pagination cursor'),
    },
    readOnly: true,
    handler: async (params, ctx) => {
      const client = await getClient(ctx)
      const result = await client.queryAntivirusThreats(params)
      return formatResult(result, client, { collectionKey: 'results' })
    },
  }),

  defineTool({
    name: 'ninja_query_computer_systems',
    description:
      'Query hardware inventory across all devices: manufacturer, model, serial numbers, memory, chassis type, domain, virtual machine flag.',
    keywords: ['ninja', 'query', 'computer systems', 'hardware', 'serial number', 'ram', 'memory', 'model'],
    params: {
      df: z.string().optional().describe(DF_DESCRIPTION),
      pageSize: z.number().optional().default(25).describe('Results per page'),
      cursor: z.string().optional().describe('Pagination cursor'),
    },
    readOnly: true,
    handler: async (params, ctx) => {
      const client = await getClient(ctx)
      const result = await client.queryComputerSystems(params)
      return formatResult(result, client, { collectionKey: 'results' })
    },
  }),

  defineTool({
    name: 'ninja_query_os_patch_installs',
    description:
      'Query OS patch install history across all devices: install attempts with status (INSTALLED or FAILED), timestamps, and KB numbers. For pending patch status use ninja_query_os_patches.',
    keywords: ['ninja', 'query', 'os patch installs', 'history', 'patch history'],
    params: {
      df: z.string().optional().describe(DF_DESCRIPTION),
      status: z.string().optional().describe('Filter by status (INSTALLED or FAILED)'),
      installedBefore: z.string().optional().describe('Only patches installed before this ISO date'),
      installedAfter: z.string().optional().describe('Only patches installed after this ISO date'),
      pageSize: z.number().optional().default(25).describe('Results per page'),
      cursor: z.string().optional().describe('Pagination cursor'),
    },
    readOnly: true,
    handler: async (params, ctx) => {
      const client = await getClient(ctx)
      const result = await client.queryOsPatchInstalls(params)
      return formatResult(result, client, { collectionKey: 'results' })
    },
  }),

  defineTool({
    name: 'ninja_query_volumes',
    description:
      'Query disk volume usage across all devices: drive letter, capacity, free space, and file system per volume.',
    keywords: ['ninja', 'query', 'volumes', 'storage', 'disk space', 'free space'],
    params: {
      df: z.string().optional().describe(DF_DESCRIPTION),
      pageSize: z.number().optional().default(25).describe('Results per page'),
      cursor: z.string().optional().describe('Pagination cursor'),
    },
    readOnly: true,
    handler: async (params, ctx) => {
      const client = await getClient(ctx)
      const result = await client.queryVolumes(params)
      return formatResult(result, client, { collectionKey: 'results' })
    },
  }),

  defineTool({
    name: 'ninja_query_operating_systems',
    description:
      'Query OS details across all devices: name, architecture, build number, release ID, last boot time, and needsReboot flag.',
    keywords: ['ninja', 'query', 'operating systems', 'os version', 'build', 'reboot'],
    params: {
      df: z.string().optional().describe(DF_DESCRIPTION),
      pageSize: z.number().optional().default(25).describe('Results per page'),
      cursor: z.string().optional().describe('Pagination cursor'),
    },
    readOnly: true,
    handler: async (params, ctx) => {
      const client = await getClient(ctx)
      const result = await client.queryOperatingSystems(params)
      return formatResult(result, client, { collectionKey: 'results' })
    },
  }),
]
