import type { NextConfig } from 'next'

const config: NextConfig = {
  output: 'export',
  trailingSlash: true,
  reactStrictMode: true,
  // rewrites only apply under `next dev`; output: 'export' ignores them entirely at build time
  async rewrites() {
    const port = process.env.CONDUIT_API_PORT ?? '4000'
    return [
      { source: '/api/:path*', destination: `http://127.0.0.1:${port}/api/:path*` },
      { source: '/mcp/:path*', destination: `http://127.0.0.1:${port}/mcp/:path*` },
      { source: '/mcp', destination: `http://127.0.0.1:${port}/mcp` },
    ]
  },
}

export default config
