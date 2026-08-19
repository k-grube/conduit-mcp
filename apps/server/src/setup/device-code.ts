import type { SetupUser } from './session.js'

export const DEFAULT_BOOTSTRAP_CLIENT_ID = '1950a258-227b-4e31-a9cf-717495945fc2'

// organizations, not common: work accounts only (matches CIPP New-DeviceLogin.ps1)
const AUTHORITY = 'https://login.microsoftonline.com/organizations'
// .default picks up the first-party client's pre-consented graph scopes
const SCOPE = 'https://graph.microsoft.com/.default offline_access openid profile'

export class DeviceCodeExpiredError extends Error {
  constructor() {
    super('device code expired, restart setup')
    this.name = 'DeviceCodeExpiredError'
  }
}

export interface DeviceCodeStart {
  deviceCode: string
  userCode: string
  verificationUri: string
  expiresIn: number
  interval: number
  message: string
}

export async function startDeviceCode(clientId: string, fetchFn: typeof fetch = fetch): Promise<DeviceCodeStart> {
  const res = await fetchFn(`${AUTHORITY}/oauth2/v2.0/devicecode`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, scope: SCOPE }),
  })
  if (!res.ok) {
    throw new Error('device code request failed: ' + (await res.text()))
  }
  const body = (await res.json()) as {
    device_code: string
    user_code: string
    verification_uri: string
    expires_in: number
    interval: number
    message: string
  }
  return {
    deviceCode: body.device_code,
    userCode: body.user_code,
    verificationUri: body.verification_uri,
    expiresIn: body.expires_in,
    interval: body.interval,
    message: body.message,
  }
}

export type DeviceCodePollResult = { pending: true } | { pending: false; accessToken: string; user: SetupUser }

export async function pollDeviceCode(
  clientId: string,
  deviceCode: string,
  fetchFn: typeof fetch = fetch,
): Promise<DeviceCodePollResult> {
  const res = await fetchFn(`${AUTHORITY}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: deviceCode,
    }),
  })
  const body = (await res.json()) as {
    error?: string
    error_description?: string
    access_token: string
  }
  if (body.error) {
    if (body.error === 'authorization_pending' || body.error === 'slow_down') {
      return { pending: true }
    }
    if (body.error === 'expired_token') {
      throw new DeviceCodeExpiredError()
    }
    throw new Error(body.error_description ?? body.error)
  }
  const payload = decodeJwtPayload(body.access_token)
  const oid = payload.oid
  const tid = payload.tid
  if (typeof oid !== 'string' || typeof tid !== 'string') {
    throw new Error('token missing oid/tid claim')
  }
  const name = typeof payload.name === 'string' ? payload.name : undefined
  const rawUpn = payload.upn ?? payload.preferred_username
  const upn = typeof rawUpn === 'string' ? rawUpn : undefined
  return { pending: false, accessToken: body.access_token, user: { oid, tid, name, upn } }
}

export function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const parts = jwt.split('.')
  if (parts.length < 2) {
    throw new Error('malformed jwt')
  }
  return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
}
