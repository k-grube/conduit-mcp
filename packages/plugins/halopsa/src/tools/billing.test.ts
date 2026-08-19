import { describe, expect, it, vi, beforeEach } from 'vitest'
import { billingTools } from './billing.js'
import { getClient, resetClient } from '../client.js'
import { fakeCtx } from '../test-helpers.js'

const listRecurringInvoices = billingTools.find((t) => t.name === 'halopsa_list_recurring_invoices')!
const getRecurringInvoice = billingTools.find((t) => t.name === 'halopsa_get_recurring_invoice')!
const getInvoice = billingTools.find((t) => t.name === 'halopsa_get_invoice')!
const listSubscriptions = billingTools.find((t) => t.name === 'halopsa_list_subscriptions')!
const getSubscription = billingTools.find((t) => t.name === 'halopsa_get_subscription')!
const listSoftwareLicenses = billingTools.find((t) => t.name === 'halopsa_list_software_licenses')!
const getSoftwareLicense = billingTools.find((t) => t.name === 'halopsa_get_software_license')!

function tokenResponse(): Response {
  return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 })
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 })
}

beforeEach(() => {
  resetClient()
})

describe('halopsa_list_recurring_invoices', () => {
  it('delegates to executeListRecurringInvoices (enabled only by default)', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const u = String(url)
      if (u.endsWith('/auth/token')) {
        return tokenResponse()
      }
      return jsonResponse({ record_count: 1, invoices: [{ id: 1, disabled: false }] })
    })
    const ctx = fakeCtx()
    await getClient(ctx, fetchFn)

    const result = (await listRecurringInvoices.handler(
      { page_size: 50, page_no: 1, include_disabled: false },
      ctx,
    )) as { invoices: unknown[] }

    expect(result.invoices).toHaveLength(1)
  })
})

describe('halopsa_get_recurring_invoice', () => {
  it('filters inactive lines by default and trims generated invoices to summary fields', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const u = String(url)
      if (u.endsWith('/auth/token')) {
        return tokenResponse()
      }
      return jsonResponse({
        id: -5,
        lines: [
          { item_shortdescription: 'active line', isinactive: false, isActive: true },
          { item_shortdescription: 'inactive line', isinactive: true },
        ],
        invoices: [{ id: 1, amountdue: 10, extra_field_dropped: 'x' }],
      })
    })
    const ctx = fakeCtx()
    await getClient(ctx, fetchFn)

    const result = (await getRecurringInvoice.handler({ id: -5, include_inactive_lines: false }, ctx)) as {
      lines: Array<Record<string, unknown>>
      invoices: Array<Record<string, unknown>>
      url: string
    }

    expect(result.lines).toHaveLength(1)
    expect(result.invoices[0]).not.toHaveProperty('extra_field_dropped')
    expect(result.url).toContain('rinvoiceid=-5')
  })
})

describe('halopsa_get_invoice', () => {
  it('trims line items and adds the invoices deep link', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const u = String(url)
      if (u.endsWith('/auth/token')) {
        return tokenResponse()
      }
      return jsonResponse({ id: 42, lines: [{ item_shortdescription: 'x', dropped: 'y' }] })
    })
    const ctx = fakeCtx()
    await getClient(ctx, fetchFn)

    const result = (await getInvoice.handler({ id: 42 }, ctx)) as {
      lines: Array<Record<string, unknown>>
      url: string
    }

    expect(result.lines[0]).not.toHaveProperty('dropped')
    expect(result.url).toContain('invoiceid=42')
  })
})

describe('halopsa_list_subscriptions', () => {
  it('requests licence_type=1 and filters inactive by default', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const u = String(url)
      if (u.endsWith('/auth/token')) {
        return tokenResponse()
      }
      expect(u).toContain('licence_type=1')
      return jsonResponse({
        record_count: 2,
        licences: [
          { id: 1, client_id: 5, is_active: true },
          { id: 2, client_id: 5, is_active: false },
        ],
      })
    })
    const ctx = fakeCtx()
    await getClient(ctx, fetchFn)

    const result = (await listSubscriptions.handler({ page_size: 50, page_no: 1, include_inactive: false }, ctx)) as {
      licences: unknown[]
    }

    expect(result.licences).toHaveLength(1)
  })
})

describe('halopsa_get_subscription', () => {
  it('fetches by id and adds a client deep link', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const u = String(url)
      if (u.endsWith('/auth/token')) {
        return tokenResponse()
      }
      return jsonResponse({ id: 9, client_id: 501 })
    })
    const ctx = fakeCtx()
    await getClient(ctx, fetchFn)

    const result = (await getSubscription.handler({ id: 9 }, ctx)) as Record<string, unknown>

    expect(result.url).toContain('clientid=501')
  })

  it('errors when the id belongs to a software license', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const u = String(url)
      if (u.endsWith('/auth/token')) {
        return tokenResponse()
      }
      return jsonResponse({ id: 9, client_id: 501, type: 0 })
    })
    const ctx = fakeCtx()
    await getClient(ctx, fetchFn)

    const result = (await getSubscription.handler({ id: 9 }, ctx)) as string

    expect(result).toContain('software license')
    expect(result).toContain('halopsa_get_software_license')
  })
})

describe('halopsa_list_software_licenses', () => {
  it('requests licence_type=0', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const u = String(url)
      if (u.endsWith('/auth/token')) {
        return tokenResponse()
      }
      expect(u).toContain('licence_type=0')
      return jsonResponse({ record_count: 0, licences: [] })
    })
    const ctx = fakeCtx()
    await getClient(ctx, fetchFn)

    await listSoftwareLicenses.handler({ page_size: 50, page_no: 1, include_inactive: false }, ctx)
  })
})

describe('halopsa_get_software_license', () => {
  it('fetches by id and adds a client deep link', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const u = String(url)
      if (u.endsWith('/auth/token')) {
        return tokenResponse()
      }
      return jsonResponse({ id: 3, client_id: 501 })
    })
    const ctx = fakeCtx()
    await getClient(ctx, fetchFn)

    const result = (await getSoftwareLicense.handler({ id: 3 }, ctx)) as Record<string, unknown>

    expect(result.url).toContain('clientid=501')
  })

  it('errors when the id belongs to a subscription', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const u = String(url)
      if (u.endsWith('/auth/token')) {
        return tokenResponse()
      }
      return jsonResponse({ id: 3, client_id: 501, type: 1 })
    })
    const ctx = fakeCtx()
    await getClient(ctx, fetchFn)

    const result = (await getSoftwareLicense.handler({ id: 3 }, ctx)) as string

    expect(result).toContain('subscription')
    expect(result).toContain('halopsa_get_subscription')
  })
})
