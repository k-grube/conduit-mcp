// validates an admin-configured integration base url before any credential is sent to it:
// https only, no embedded credentials/query/fragment, and no private/loopback/link-local host
// (blocks ssrf to internal services and the cloud metadata endpoint). returns origin + trimmed path.
export function assertEgressUrl(raw: string): string {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('integration base url is not a valid url')
  }
  if (url.protocol !== 'https:') {
    throw new Error('integration base url must be https')
  }
  if (url.username || url.password) {
    throw new Error('integration base url must not embed credentials')
  }
  if (url.search || url.hash) {
    throw new Error('integration base url must not have a query or fragment')
  }
  if (isPrivateHost(url.hostname)) {
    throw new Error('integration base url must not point at a private, loopback, or link-local address')
  }
  return url.origin + url.pathname.replace(/\/+$/, '')
}

function isPrivateHost(hostname: string): boolean {
  // URL.hostname keeps the brackets on an ipv6 literal, drop them before matching
  const host = hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '')
  if (host === 'localhost' || host.endsWith('.localhost')) {
    return true
  }
  if (host.includes(':')) {
    return (
      host === '::1' ||
      host === '::' ||
      host.startsWith('fe80:') ||
      host.startsWith('fc') ||
      host.startsWith('fd') ||
      host.startsWith('::ffff:')
    )
  }
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/)
  if (!m) {
    return false
  }
  const a = Number(m[1])
  const b = Number(m[2])
  if (a === 0 || a === 10 || a === 127) {
    return true
  }
  if (a === 169 && b === 254) {
    return true
  }
  if (a === 172 && b >= 16 && b <= 31) {
    return true
  }
  if (a === 192 && b === 168) {
    return true
  }
  return false
}
