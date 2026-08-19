import { describe, expect, it } from 'vitest'
import { assertEgressUrl } from './egress.js'

describe('assertEgressUrl', () => {
  it('accepts a public https url and strips trailing slashes', () => {
    expect(assertEgressUrl('https://acme.halopsa.com')).toBe('https://acme.halopsa.com')
    expect(assertEgressUrl('https://acme.halopsa.com/')).toBe('https://acme.halopsa.com')
    expect(assertEgressUrl('https://cipp.example.com/base/')).toBe('https://cipp.example.com/base')
  })

  it('rejects non-https', () => {
    expect(() => assertEgressUrl('http://acme.halopsa.com')).toThrow()
    expect(() => assertEgressUrl('ftp://acme.halopsa.com')).toThrow()
  })

  it('rejects embedded credentials, query, or fragment', () => {
    expect(() => assertEgressUrl('https://user:pass@acme.halopsa.com')).toThrow()
    expect(() => assertEgressUrl('https://acme.halopsa.com/?next=x')).toThrow()
    expect(() => assertEgressUrl('https://acme.halopsa.com/#frag')).toThrow()
  })

  it('rejects private, loopback, and link-local hosts', () => {
    for (const h of [
      'https://localhost',
      'https://foo.localhost',
      'https://127.0.0.1',
      'https://10.0.0.5',
      'https://172.16.0.1',
      'https://172.31.255.255',
      'https://192.168.1.1',
      'https://169.254.169.254',
      'https://[::1]',
      'https://[fe80::1]',
      'https://[fd00::1]',
    ]) {
      expect(() => assertEgressUrl(h), h).toThrow()
    }
  })

  it('allows a public ipv4 that is adjacent to a private range', () => {
    expect(assertEgressUrl('https://172.32.0.1')).toBe('https://172.32.0.1')
  })

  it('rejects a non-url', () => {
    expect(() => assertEgressUrl('not a url')).toThrow()
  })
})
