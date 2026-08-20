import type { RequestHandler } from 'express'

// next static export inlines hydration scripts and mui/emotion inlines styles, so script/style
// need 'unsafe-inline'; msal reaches entra for token acquisition (fetch + silent-refresh iframe);
// fonts load from google. frame-ancestors 'self' blocks cross-origin clickjacking while letting
// msal's hidden iframe land back on the app origin (the silent-refresh return leg)
const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'self'",
  "img-src 'self' data:",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "connect-src 'self' https://login.microsoftonline.com",
  "frame-src 'self' https://login.microsoftonline.com",
  "form-action 'self'",
].join('; ')

// static response security headers for the portal + api. hsts only bites over https (azure ingress)
export function securityHeaders(): RequestHandler {
  return (_req, res, next) => {
    res.setHeader('Content-Security-Policy', CSP)
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('X-Frame-Options', 'SAMEORIGIN')
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
    res.setHeader('Strict-Transport-Security', 'max-age=31536000')
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
    next()
  }
}
