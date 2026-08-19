import { describe, expect, it, vi, beforeEach } from 'vitest'
import { accountTools } from './accounts.js'
import { resetQboClient } from '../client.js'
import { fakeCtx, fakeStore, seedQboClient } from '../test-helpers.js'
import { INTUIT_TOKEN_URL } from '../oauth.js'

const listAccounts = accountTools.find((t) => t.name === 'qbo_list_accounts')!
const getAccount = accountTools.find((t) => t.name === 'qbo_get_account')!

const CONNECTED_SECRETS = {
  QBO_SANDBOX_CLIENT_ID: 'id',
  QBO_SANDBOX_CLIENT_SECRET: 'secret',
  QBO_SANDBOX_REFRESH_TOKEN: 'refresh',
}

function tokenResponse(): Response {
  return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600, refresh_token: 'r2' }), { status: 200 })
}

function connectedCtx(): ReturnType<typeof fakeCtx> {
  return fakeCtx({ secrets: CONNECTED_SECRETS, store: fakeStore({ 'state:sandbox': { realmId: '9' } }) })
}

beforeEach(() => {
  resetQboClient()
})

describe('qbo_list_accounts', () => {
  it('filters by account_type and account_subtype in the sql where clause', async () => {
    let capturedUrl: string | undefined
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === INTUIT_TOKEN_URL) {
        return tokenResponse()
      }
      capturedUrl = String(url)
      return new Response(JSON.stringify({ QueryResponse: {} }), { status: 200 })
    })
    const ctx = connectedCtx()
    await seedQboClient(ctx, fetchFn)

    await listAccounts.handler({ account_type: 'Expense', account_subtype: 'Utilities', page: 1, page_size: 25 }, ctx)

    const sql = new URL(capturedUrl!).searchParams.get('query')
    expect(sql).toContain("AccountType = 'Expense'")
    expect(sql).toContain("AccountSubType = 'Utilities'")
  })

  it('maps accounts to camelCase and adds a register deep link', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === INTUIT_TOKEN_URL) {
        return tokenResponse()
      }
      return new Response(
        JSON.stringify({ QueryResponse: { Account: [{ Id: '3', Name: 'Checking', CurrentBalance: 500 }] } }),
        { status: 200 },
      )
    })
    const ctx = connectedCtx()
    await seedQboClient(ctx, fetchFn)

    const result = (await listAccounts.handler({ page: 1, page_size: 25 }, ctx)) as {
      accounts: Array<Record<string, unknown>>
    }

    expect(result.accounts[0]).toMatchObject({
      id: '3',
      name: 'Checking',
      currentBalance: 500,
      url: 'https://sandbox.qbo.intuit.com/app/register?accountId=3',
    })
  })
})

describe('qbo_get_account', () => {
  it('returns the raw account with a deep link url', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === INTUIT_TOKEN_URL) {
        return tokenResponse()
      }
      return new Response(JSON.stringify({ Account: { Id: '11' } }), { status: 200 })
    })
    const ctx = connectedCtx()
    await seedQboClient(ctx, fetchFn)

    const result = await getAccount.handler({ account_id: '11' }, ctx)

    expect(result).toMatchObject({ Id: '11', url: expect.stringContaining('accountId=11') })
  })
})
