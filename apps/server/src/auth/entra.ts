import { createRemoteJWKSet, jwtVerify } from 'jose'
import { logEvent } from '../logger.js'

export interface EntraConfig {
  tenantId: string
  clientId: string
}

type KeyResolver = Parameters<typeof jwtVerify>[1]

export class EntraValidator {
  private cfg: EntraConfig
  private keyResolver: KeyResolver

  constructor(cfg: EntraConfig, keyResolver?: KeyResolver) {
    this.cfg = cfg
    this.keyResolver =
      keyResolver ??
      createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${cfg.tenantId}/discovery/v2.0/keys`))
  }

  async validate(token: string): Promise<{ oid: string; groups: string[]; scopes: string[]; name?: string }> {
    const { payload } = await jwtVerify(token, this.keyResolver, {
      issuer: `https://login.microsoftonline.com/${this.cfg.tenantId}/v2.0`,
      audience: this.cfg.clientId,
      algorithms: ['RS256'],
    })
    const oid = payload.oid
    if (typeof oid !== 'string' || !oid) {
      throw new Error('token missing oid claim')
    }
    const groups = Array.isArray(payload.groups) ? payload.groups.filter((g): g is string => typeof g === 'string') : []
    if (payload._claim_names && payload.groups === undefined) {
      logEvent('auth', 'group_overage', { oid })
    }
    const name = typeof payload.name === 'string' ? payload.name : undefined
    const scopes = typeof payload.scp === 'string' ? payload.scp.split(' ').filter(Boolean) : []
    return { oid, groups, scopes, name }
  }
}
