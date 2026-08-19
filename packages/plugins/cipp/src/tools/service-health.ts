import { defineTool, z, type ToolDef } from '@conduit-mcp/plugin-sdk'

const SERVICE_HEALTH_URL = 'https://status.cipp.app/data/serviceHealth.json'
const FETCH_TIMEOUT_MS = 10_000

export interface ServiceHealthRegion {
  name: string
  code: string
  status: string
  serviceEvents: unknown[]
}

export interface ServiceHealthResponse {
  timestamp: string
  totalRegions: number
  regions: ServiceHealthRegion[]
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function normalizeNeedle(needle: string): string {
  // strip the literal word "region(s)" so callers can pass natural phrases like "us east region"
  return normalize(needle.replace(/\bregions?\b/gi, ''))
}

function rotations(s: string): string[] {
  const out: string[] = []
  for (let i = 0; i < s.length; i++) {
    out.push(s.slice(i) + s.slice(0, i))
  }
  return out
}

// fuzzy match a needle against a region's code/name. handles the standard substring case
// ("brazil" -> "brazilsouth") and the azure-naming-flip case ("uswest" -> "westus"). trailing
// digits in the haystack are stripped so "uswest" also matches "westus2"/"westus3"
export function matchRegion(needle: string, region: { code: string; name: string }): boolean {
  const n = normalizeNeedle(needle)
  if (!n) {
    return false
  }
  const haystacks = [region.code.toLowerCase(), normalize(region.name)]
  for (const raw of haystacks) {
    const stripped = raw.replace(/\d+$/, '')
    for (const h of [raw, stripped]) {
      if (!h) {
        continue
      }
      if (h.includes(n) || n.includes(h)) {
        return true
      }
      if (n.length === h.length && rotations(n).includes(h)) {
        return true
      }
    }
  }
  return false
}

// fetchFn injectable so tests never hit the network
export async function fetchServiceHealth(
  regions?: string[],
  fetchFn: typeof fetch = fetch,
): Promise<ServiceHealthResponse> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  let response: Response
  try {
    response = await fetchFn(SERVICE_HEALTH_URL, { signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
  if (!response.ok) {
    throw new Error(`CIPP service health fetch failed: HTTP ${response.status} ${response.statusText}`)
  }
  const data = (await response.json()) as ServiceHealthResponse
  if (!regions || regions.length === 0) {
    return data
  }
  const filtered = data.regions.filter((r) => regions.some((needle) => matchRegion(needle, r)))
  return { ...data, regions: filtered }
}

export const serviceHealthTools: ToolDef[] = [
  defineTool({
    name: 'cipp_service_health',
    description:
      'Check the public CIPP Azure service health feed (https://status.cipp.app/data/serviceHealth.json). Returns Azure regions and any active service events (incidents, planned maintenance) reported upstream by Microsoft. Global Azure status, not per-tenant M365 service health; no tenant or credentials involved. Optional fuzzy region filter accepts code or name in any word order, e.g. ["uswest"] matches westus/westus2/westus3, ["us east"] matches eastus/eastus2, ["brazil"] matches brazilsouth.',
    keywords: ['cipp', 'service health', 'azure', 'status', 'regions', 'outage', 'incident', 'maintenance'],
    params: {
      regions: z
        .array(z.string())
        .optional()
        .describe(
          'Optional fuzzy region filter. Each entry matches an Azure region by code or name, case-insensitive, word-order-insensitive. Omit to return all regions.',
        ),
    },
    readOnly: true,
    handler: async (params) => {
      return fetchServiceHealth(params.regions)
    },
  }),
]
