import { randomBytes, timingSafeEqual } from 'node:crypto'

export type SetupStepId = 'app' | 'manifest' | 'sp' | 'consent' | 'secret' | 'store' | 'admin' | 'config'

export interface SetupStepState {
  id: SetupStepId
  state: 'pending' | 'active' | 'done' | 'error'
  detail?: string
}

export interface SetupUser {
  oid: string
  tid: string
  name?: string
  upn?: string
}

export interface SetupResult {
  tenantId: string
  clientId: string
  consentGranted: boolean
  consentCommand?: string
  secretStored: 'keyvault' | 'shown'
  clientSecret?: string
}

export interface SetupSession {
  token: string
  deviceCode: string
  interval: number
  accessToken?: string
  user?: SetupUser
  provisioning: boolean
  steps: SetupStepState[]
  result?: SetupResult
  error?: string
}

export const SETUP_STEP_IDS = [
  'app',
  'manifest',
  'sp',
  'consent',
  'secret',
  'store',
  'admin',
  'config',
] as const satisfies readonly SetupStepId[]

export function freshSteps(): SetupStepState[] {
  return SETUP_STEP_IDS.map((id) => ({ id, state: 'pending' as const }))
}

const TTL_MS = 15 * 60 * 1000

export class SetupSessionStore {
  private session: SetupSession | undefined
  private startedAt = 0
  private now: () => number

  constructor(now: () => number = Date.now) {
    this.now = now
  }

  start(deviceCode: string, interval: number): SetupSession {
    this.session = {
      token: randomBytes(32).toString('base64url'),
      deviceCode,
      interval,
      provisioning: false,
      steps: freshSteps(),
    }
    this.startedAt = this.now()
    return this.session
  }

  get(): SetupSession | undefined {
    if (this.session && this.now() - this.startedAt > TTL_MS) {
      this.session = undefined
    }
    return this.session
  }

  clear(): void {
    this.session = undefined
  }
}

// constant-time check that a caller-supplied token matches the live session's, guards the
// mutating setup routes and the sensitive status block against a second party riding the session
export function tokenMatches(token: string | undefined, session: SetupSession): boolean {
  if (!token) {
    return false
  }
  const a = Buffer.from(token)
  const b = Buffer.from(session.token)
  if (a.length !== b.length) {
    return false
  }
  return timingSafeEqual(a, b)
}
