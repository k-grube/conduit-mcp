import type { TokenCredential } from '@azure/identity'

export interface UpdateStatus {
  runningSha?: string
  imageRef?: string
  tag?: string
  remoteSha?: string
  remoteCreated?: string
  updateAvailable?: boolean
  // set when the check cannot run (image identity not baked in, non-ghcr ref)
  unavailable?: string
}

const MANIFEST_ACCEPT = [
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.v2+json',
].join(', ')

interface ManifestEntry {
  digest: string
  platform?: { architecture?: string; os?: string }
}

interface Manifest {
  manifests?: ManifestEntry[]
  config?: { digest: string }
  annotations?: Record<string, string>
}

async function ghcrJson<T>(fetchFn: typeof fetch, url: string, headers: Record<string, string>): Promise<T> {
  const res = await fetchFn(url, { headers })
  if (!res.ok) {
    throw new Error(`ghcr request failed: ${res.status}`)
  }
  return (await res.json()) as T
}

// CONDUIT_IMAGE_REF/CONDUIT_IMAGE_SHA are baked in by the CI docker build, compare the
// running sha against the revision label of whatever the checked tag currently points at
export async function checkForUpdate(env: NodeJS.ProcessEnv, fetchFn: typeof fetch = fetch): Promise<UpdateStatus> {
  const ref = env.CONDUIT_IMAGE_REF
  const runningSha = env.CONDUIT_IMAGE_SHA
  if (!ref || !runningSha) {
    return { unavailable: 'image identity not baked into this build' }
  }
  if (!ref.startsWith('ghcr.io/')) {
    return { runningSha, imageRef: ref, unavailable: 'update check only supports ghcr images' }
  }
  const bare = ref.slice('ghcr.io/'.length)
  const colon = bare.lastIndexOf(':')
  const imagePath = colon > 0 ? bare.slice(0, colon) : bare
  const tag = colon > 0 ? bare.slice(colon + 1) : 'latest'

  const tokenBody = await ghcrJson<{ token: string }>(
    fetchFn,
    `https://ghcr.io/token?scope=repository:${imagePath}:pull`,
    {},
  )
  const auth = { authorization: `Bearer ${tokenBody.token}` }

  let manifest = await ghcrJson<Manifest>(fetchFn, `https://ghcr.io/v2/${imagePath}/manifests/${tag}`, {
    ...auth,
    accept: MANIFEST_ACCEPT,
  })
  if (manifest.manifests) {
    // buildx pushes an index holding the image plus attestation manifests (platform unknown/unknown)
    const child = manifest.manifests.find((m) => m.platform?.architecture === 'amd64' && m.platform?.os === 'linux')
    if (!child) {
      throw new Error('no linux/amd64 manifest in image index')
    }
    manifest = await ghcrJson<Manifest>(fetchFn, `https://ghcr.io/v2/${imagePath}/manifests/${child.digest}`, {
      ...auth,
      accept: MANIFEST_ACCEPT,
    })
  }

  let remoteSha = manifest.annotations?.['org.opencontainers.image.revision']
  let remoteCreated = manifest.annotations?.['org.opencontainers.image.created']
  if ((!remoteSha || !remoteCreated) && manifest.config?.digest) {
    const config = await ghcrJson<{ config?: { Labels?: Record<string, string> } }>(
      fetchFn,
      `https://ghcr.io/v2/${imagePath}/blobs/${manifest.config.digest}`,
      auth,
    )
    remoteSha = remoteSha ?? config.config?.Labels?.['org.opencontainers.image.revision']
    remoteCreated = remoteCreated ?? config.config?.Labels?.['org.opencontainers.image.created']
  }
  if (!remoteSha) {
    return { runningSha, imageRef: ref, tag, unavailable: 'registry image carries no revision label' }
  }
  return { runningSha, imageRef: ref, tag, remoteSha, remoteCreated, updateAvailable: remoteSha !== runningSha }
}

// per-session mcp instructions line, reaches the model (not reliably the human), best-effort nudge
export function updateNotice(status: UpdateStatus | undefined): string | undefined {
  if (!status?.updateAvailable || !status.runningSha || !status.remoteSha) {
    return undefined
  }
  return (
    `A conduit-mcp server update is available: running ${status.runningSha.slice(0, 7)}, ` +
    `the ${status.tag ?? 'latest'} tag now points at ${status.remoteSha.slice(0, 7)}. ` +
    'Mention this to the user; a portal admin can apply it from the settings page (Restart server).'
  )
}

export interface UpdateCache {
  // live registry round trip, caches on success, rethrows on failure
  check(): Promise<UpdateStatus>
  // fresh cached value, or a live check when stale/empty
  get(): Promise<UpdateStatus>
  // cached status if fresh, undefined otherwise; stale/empty kicks a background refresh
  peek(): UpdateStatus | undefined
}

export function createUpdateCache(
  env: NodeJS.ProcessEnv,
  fetchFn: typeof fetch = fetch,
  opts: { ttlMs?: number; cooldownMs?: number; now?: () => number } = {},
): UpdateCache {
  const ttlMs = opts.ttlMs ?? 60 * 60 * 1000
  const cooldownMs = opts.cooldownMs ?? 5 * 60 * 1000
  const now = opts.now ?? Date.now
  let cached: { status: UpdateStatus; fetchedAt: number } | undefined
  let attemptedAt: number | undefined
  let inflight: Promise<UpdateStatus> | undefined

  async function check(): Promise<UpdateStatus> {
    attemptedAt = now()
    inflight = inflight ?? checkForUpdate(env, fetchFn)
    try {
      const status = await inflight
      cached = { status, fetchedAt: now() }
      return status
    } finally {
      inflight = undefined
    }
  }

  async function get(): Promise<UpdateStatus> {
    if (cached && now() - cached.fetchedAt < ttlMs) {
      return cached.status
    }
    return check()
  }

  function peek(): UpdateStatus | undefined {
    if (cached && now() - cached.fetchedAt < ttlMs) {
      return cached.status
    }
    // cooldown keeps a ghcr outage from turning every mcp session into a fetch attempt
    if (!inflight && (attemptedAt === undefined || now() - attemptedAt >= cooldownMs)) {
      void check().catch(() => {})
    }
    return undefined
  }

  return { check, get, peek }
}

// WEBSITE_OWNER_NAME is `<subscriptionId>+<webspace>`, app service sets all three
export function siteFromEnv(env: NodeJS.ProcessEnv): { subscription: string; rg: string; site: string } | undefined {
  const subscription = env.WEBSITE_OWNER_NAME?.split('+')[0]
  const rg = env.WEBSITE_RESOURCE_GROUP
  const site = env.WEBSITE_SITE_NAME
  if (!subscription || !rg || !site) {
    return undefined
  }
  return { subscription, rg, site }
}

// ARM restart with the MI, authorized by the restart-only custom role in resources.bicep.
// restart re-resolves the configured tag, so on :latest this is also "apply update"
export async function restartSite(
  env: NodeJS.ProcessEnv,
  credential: TokenCredential,
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  const site = siteFromEnv(env)
  if (!site) {
    throw new Error('not running on app service, restart from the hosting platform instead')
  }
  const token = await credential.getToken('https://management.azure.com/.default')
  if (!token) {
    throw new Error('failed to acquire management token')
  }
  const url = `https://management.azure.com/subscriptions/${site.subscription}/resourceGroups/${site.rg}/providers/Microsoft.Web/sites/${site.site}/restart?api-version=2024-04-01`
  const res = await fetchFn(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token.token}` },
    // never follow a redirect, a cross-origin hop would replay the management token to another host
    redirect: 'error',
  })
  if (!res.ok) {
    throw new Error(`restart request failed: ${res.status}`)
  }
}
