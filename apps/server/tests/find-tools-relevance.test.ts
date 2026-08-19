import { beforeAll, describe, expect, it } from 'vitest'
import { loadRealPluginCatalog, type RealPluginCatalog } from './helpers/load-real-plugins.js'

let rip: RealPluginCatalog

beforeAll(async () => {
  rip = await loadRealPluginCatalog('Rel')
}, 60_000)

const cases: [query: string, expected: string][] = [
  ['open tickets for a customer', 'halopsa_list_tickets'],
  ['knowledge base article about onboarding', 'hudu_search_articles'],
  ['user sign in logs', 'cipp_list_signin_logs'],
  ['devices missing patches', 'ninja_query_os_patches'],
  ['customer invoice balance', 'qbo_list_invoices'],
  ['conditional access policies', 'cipp_list_ca_policies'],
  ['who is out of office', 'halopsa_agent_availability'],
  ['antivirus threats on endpoints', 'ninja_query_antivirus_threats'],
]

describe('find_tools relevance', () => {
  for (const [query, expected] of cases) {
    it(`finds ${expected} for "${query}"`, () => {
      const names = rip.search.search(query, { limit: 5 }).map((r) => r.name)
      expect(names).toContain(expected)
    })
  }
})
