const KEY = 'conduit-setup-token'

// /device-code returns a per-session setup token; every later setup call carries it so only the
// caller that started the flow can drive poll/provision/manual or read the session status block
export function rememberSetupToken(token: string): void {
  sessionStorage.setItem(KEY, token)
}

export function setupTokenHeaders(): Record<string, string> {
  const token = sessionStorage.getItem(KEY)
  return token ? { 'x-setup-token': token } : {}
}
