import { describe, expect, it, vi } from 'vitest'
import type { PluginContext } from '@conduit-mcp/plugin-sdk'
import { deviceTools, listMaintenanceDevices, wrapDeviceListPayload, type MaintenanceDevicesClient } from './devices.js'

const holder = vi.hoisted(() => ({ client: undefined as unknown }))
vi.mock('../client.js', () => ({
  getClient: async () => holder.client,
}))

const ctx = {} as PluginContext

function tool(name: string) {
  const t = deviceTools.find((t) => t.name === name)
  if (!t) {
    throw new Error(`tool ${name} not found`)
  }
  return t
}

function device(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    systemName: `dev-${id}`,
    organizationId: 1,
    nodeClass: 'WINDOWS_WORKSTATION',
    offline: false,
    ...overrides,
  }
}

describe('listMaintenanceDevices pagination', () => {
  it('pages through 1000-row chunks and stops once a short page is returned', async () => {
    const page1 = Array.from({ length: 1000 }, (_, i) => device(i + 1))
    const page2 = [device(1001, { maintenance: { status: 'IN_MAINTENANCE', start: 100, end: 0 } })]
    const getDevices = vi.fn().mockResolvedValueOnce(page1).mockResolvedValueOnce(page2)
    const client: MaintenanceDevicesClient = {
      baseUrl: 'https://app.ninjarmm.com',
      getOrganizations: vi.fn().mockResolvedValue([{ id: 1, name: 'Acme' }]),
      getDevices,
    }

    const result = (await listMaintenanceDevices(client, {})) as { count: number; devices: unknown[] }

    expect(getDevices).toHaveBeenCalledTimes(2)
    expect(getDevices).toHaveBeenNthCalledWith(1, { pageSize: 1000 })
    expect(getDevices).toHaveBeenNthCalledWith(2, { pageSize: 1000, after: 1000 })
    expect(result.count).toBe(1)
  })

  it('does not page further when the first page is already short', async () => {
    const getDevices = vi.fn().mockResolvedValueOnce([device(1, { maintenance: { status: 'IN_MAINTENANCE' } })])
    const client: MaintenanceDevicesClient = {
      baseUrl: 'https://app.ninjarmm.com',
      getOrganizations: vi.fn().mockResolvedValue([{ id: 1, name: 'Acme' }]),
      getDevices,
    }

    const result = (await listMaintenanceDevices(client, {})) as { count: number }

    expect(getDevices).toHaveBeenCalledTimes(1)
    expect(result.count).toBe(1)
  })

  it('filters to only devices in maintenance, honoring openEndedOnly', async () => {
    const getDevices = vi
      .fn()
      .mockResolvedValueOnce([
        device(1, { maintenance: { status: 'IN_MAINTENANCE', start: 1, end: 0 } }),
        device(2, { maintenance: { status: 'IN_MAINTENANCE', start: 1, end: 999999999 } }),
        device(3),
      ])
    const client: MaintenanceDevicesClient = {
      baseUrl: 'https://app.ninjarmm.com',
      getOrganizations: vi.fn().mockResolvedValue([{ id: 1, name: 'Acme' }]),
      getDevices,
    }

    const result = (await listMaintenanceDevices(client, { openEndedOnly: true })) as {
      count: number
      devices: Array<{ id: number }>
    }

    expect(result.count).toBe(1)
    expect(result.devices[0].id).toBe(1)
  })
})

describe('ninja_search_devices', () => {
  it('adds dashboard urls to each device in the {query, devices} envelope, not the envelope itself', async () => {
    holder.client = {
      baseUrl: 'https://app.ninjarmm.com',
      searchDevices: vi.fn().mockResolvedValue({
        query: 'dev-7',
        devices: [{ id: 7, systemName: 'dev-7' }],
      }),
    }

    const result = (await tool('ninja_search_devices').handler({ query: 'dev-7', limit: 10 }, ctx)) as {
      url?: string
      devices: Array<{ id: number; url?: string }>
    }

    expect(result.url).toBeUndefined()
    expect(result.devices).toHaveLength(1)
    expect(result.devices[0].url).toBe('https://app.ninjarmm.com/#/deviceDashboard/7/overview')
  })
})

describe('patch tools pick spec-shaped fields', () => {
  it('ninja_get_device_software_patches keeps title from the spec payload', async () => {
    holder.client = {
      baseUrl: 'https://app.ninjarmm.com',
      getDeviceSoftwarePatches: vi.fn().mockResolvedValue([
        {
          id: 'a1b2',
          productIdentifier: 'c3d4',
          title: 'Firefox 118.0.1',
          impact: 'RECOMMENDED',
          status: 'APPROVED',
          type: 'PATCH',
          installedAt: 1700000000,
        },
      ]),
    }

    const result = (await tool('ninja_get_device_software_patches').handler({ id: 1 }, ctx)) as {
      items: Array<Record<string, unknown>>
    }

    expect(result.items[0].title).toBe('Firefox 118.0.1')
    expect(result.items[0].status).toBe('APPROVED')
    expect(result.items[0].type).toBe('PATCH')
    expect(result.items[0].impact).toBe('RECOMMENDED')
  })

  it('ninja_get_device_patch_installs keeps installedAt from the spec payload', async () => {
    holder.client = {
      baseUrl: 'https://app.ninjarmm.com',
      getDeviceOsPatchInstalls: vi.fn().mockResolvedValue([
        {
          id: 'a1b2',
          name: '2023-10 Cumulative Update',
          severity: 'CRITICAL',
          status: 'INSTALLED',
          type: 'UPDATE_ROLLUPS',
          installedAt: 1700000000,
          kbNumber: '5031354',
        },
      ]),
    }

    const result = (await tool('ninja_get_device_patch_installs').handler({ id: 1 }, ctx)) as {
      items: Array<Record<string, unknown>>
    }

    expect(result.items[0].installedAt).toBe(1700000000)
    expect(result.items[0].name).toBe('2023-10 Cumulative Update')
    expect(result.items[0].kbNumber).toBe('5031354')
    expect(result.items[0].status).toBe('INSTALLED')
  })

  it('ninja_get_device_os_patches keeps installedAt from the spec payload', async () => {
    holder.client = {
      baseUrl: 'https://app.ninjarmm.com',
      getDeviceOsPatches: vi.fn().mockResolvedValue([
        {
          id: 'a1b2',
          name: '2023-10 Cumulative Update',
          severity: 'CRITICAL',
          status: 'MANUAL',
          type: 'UPDATE_ROLLUPS',
          installedAt: 1700000000,
          kbNumber: '5031354',
        },
      ]),
    }

    const result = (await tool('ninja_get_device_os_patches').handler({ id: 1 }, ctx)) as {
      items: Array<Record<string, unknown>>
    }

    expect(result.items[0].installedAt).toBe(1700000000)
    expect(result.items[0].kbNumber).toBe('5031354')
  })
})

describe('wrapDeviceListPayload', () => {
  it('sets page_cap_reached and next_after when returned count hits the requested page size', () => {
    const items = [device(1), device(2)]
    const client = { baseUrl: 'https://app.ninjarmm.com' }

    const payload = wrapDeviceListPayload(items, 2, client) as {
      page_cap_reached: boolean
      next_after: number | null
    }

    expect(payload.page_cap_reached).toBe(true)
    expect(payload.next_after).toBe(2)
  })

  it('leaves next_after null when fewer rows than pageSize come back', () => {
    const items = [device(1)]
    const client = { baseUrl: 'https://app.ninjarmm.com' }

    const payload = wrapDeviceListPayload(items, 50, client) as {
      page_cap_reached: boolean
      next_after: number | null
    }

    expect(payload.page_cap_reached).toBe(false)
    expect(payload.next_after).toBeNull()
  })
})
