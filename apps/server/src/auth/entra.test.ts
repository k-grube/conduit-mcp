import { SignJWT, generateKeyPair, type CryptoKey } from 'jose'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { EntraValidator } from './entra.js'

const cfg = { tenantId: 'tid-1', clientId: 'client-1' }
const ISSUER = 'https://login.microsoftonline.com/tid-1/v2.0'

let privateKey: CryptoKey
let publicKey: CryptoKey

beforeAll(async () => {
  const pair = await generateKeyPair('RS256')
  privateKey = pair.privateKey
  publicKey = pair.publicKey
})

function makeValidator() {
  return new EntraValidator(cfg, async () => publicKey)
}

async function sign(claims: Record<string, unknown>, opts: { iss?: string; aud?: string } = {}) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(opts.iss ?? ISSUER)
    .setAudience(opts.aud ?? cfg.clientId)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey)
}

describe('EntraValidator', () => {
  it('accepts a valid token and extracts claims', async () => {
    const token = await sign({ oid: 'oid-1', groups: ['g1', 'g2'], name: 'Kevin' })
    expect(await makeValidator().validate(token)).toEqual({
      oid: 'oid-1',
      groups: ['g1', 'g2'],
      scopes: [],
      name: 'Kevin',
    })
  })

  it('defaults groups to empty (overage case)', async () => {
    const token = await sign({ oid: 'oid-1' })
    const result = await makeValidator().validate(token)
    expect(result.groups).toEqual([])
    expect(result.scopes).toEqual([])
  })

  it('logs group_overage when _claim_names indicates groups were split out', async () => {
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const token = await sign({ oid: 'oid-1', _claim_names: { groups: 'src1' } })
    const result = await makeValidator().validate(token)
    expect(result.groups).toEqual([])
    const lines = spy.mock.calls.map(([line]) => String(line))
    expect(lines.some((l) => l.includes('group_overage') && l.includes('oid-1'))).toBe(true)
    spy.mockRestore()
  })

  it('rejects wrong audience', async () => {
    const token = await sign({ oid: 'oid-1' }, { aud: 'someone-else' })
    await expect(makeValidator().validate(token)).rejects.toThrow()
  })

  it('rejects wrong issuer', async () => {
    const token = await sign({ oid: 'oid-1' }, { iss: 'https://evil.example/v2.0' })
    await expect(makeValidator().validate(token)).rejects.toThrow()
  })

  it('rejects missing oid', async () => {
    const token = await sign({ sub: 'x' })
    await expect(makeValidator().validate(token)).rejects.toThrow(/missing oid/)
  })

  it('rejects expired tokens', async () => {
    const token = await new SignJWT({ oid: 'oid-1' })
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer(ISSUER)
      .setAudience(cfg.clientId)
      .setIssuedAt(Math.floor(Date.now() / 1000) - 600)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 300)
      .sign(privateKey)
    await expect(makeValidator().validate(token)).rejects.toThrow()
  })

  it('parses scopes from scp and defaults empty', async () => {
    const withScp = await sign({ oid: 'oid-1', scp: 'portal.access openid' })
    expect((await makeValidator().validate(withScp)).scopes).toEqual(['portal.access', 'openid'])
    const without = await sign({ oid: 'oid-1' })
    expect((await makeValidator().validate(without)).scopes).toEqual([])
  })
})
