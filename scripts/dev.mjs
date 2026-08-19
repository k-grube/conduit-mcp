#!/usr/bin/env node
// concurrently child wrapper: loads .dev.env, waits on dependencies, then runs the real
// process. usage: node scripts/dev.mjs server [--no-watch] | node scripts/dev.mjs web
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const target = process.argv[2]
const noWatch = process.argv.includes('--no-watch')

function fail(msg) {
  console.error(`dev ${target ?? ''}: ${msg}`)
  process.exit(1)
}

// .dev.env: KEY=VALUE lines (entra tenant/client id etc for real portal auth locally)
const devEnv = {}
const envFile = path.join(repoRoot, '.dev.env')
if (fs.existsSync(envFile)) {
  for (const raw of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) {
      continue
    }
    const idx = line.indexOf('=')
    if (idx < 1) {
      continue
    }
    devEnv[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
  }
}

// api port comes from .dev.env only, ambient shell PORT (yarn/next leftovers) is ignored
const apiPort = devEnv.PORT ?? '4000'

function probePort(port) {
  return new Promise((resolve) => {
    const s = net.createConnection({ port, host: '127.0.0.1' })
    s.setTimeout(500, () => {
      s.destroy()
      resolve(false)
    })
    s.on('connect', () => {
      s.destroy()
      resolve(true)
    })
    s.on('error', () => {
      resolve(false)
    })
  })
}

async function waitFor(what, timeoutMs, check) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await check()) {
      return
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  fail(`timed out waiting for ${what}`)
}

function run(cmd, args, env) {
  const child = args
    ? spawn(cmd, args, { cwd: repoRoot, env, stdio: 'inherit' })
    : spawn(cmd, { cwd: repoRoot, env, stdio: 'inherit', shell: true })
  child.on('exit', (code) => {
    process.exit(code ?? 1)
  })
}

async function server() {
  if (!noWatch && apiPort === '3000') {
    fail('PORT=3000 conflicts with the web dev server, set a different PORT in .dev.env')
  }
  const serverDist = path.join(repoRoot, 'apps', 'server', 'dist')
  const sdkDist = path.join(repoRoot, 'packages', 'plugin-sdk', 'dist')
  const entry = path.join(serverDist, 'index.js')
  if (noWatch && !fs.existsSync(entry)) {
    fail('apps/server/dist missing, run pnpm build first')
  }
  // server reads config/roles/plugins from table storage at boot
  await waitFor('azurite table port 10202', 30_000, () => probePort(10202))
  if (!noWatch) {
    // tsc watchers emit dist on startup, a clean tree just takes a moment
    await waitFor(
      'tsc dist output',
      120_000,
      async () => fs.existsSync(entry) && fs.existsSync(path.join(sdkDist, 'index.js')),
    )
  }
  const env = {
    ...process.env,
    ...devEnv,
    PORT: apiPort,
    AZURE_TABLES_CONNECTION_STRING:
      'DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;TableEndpoint=http://127.0.0.1:10202/devstoreaccount1;',
    WEB_DIST: path.join(repoRoot, 'apps', 'web', 'out'),
    IN_REPO_PLUGINS_DIR: path.join(repoRoot, 'packages', 'plugins'),
    PLUGINS_ROOT: path.join(repoRoot, '.dev', 'plugins'),
  }
  // watch only the tsc output trees: plain --watch also tracks the loader-written
  // .dev/plugins/.build bundles, and ntfs last-access flushes on those restart the server
  // mid-setup. --watch-path is macOS/windows only, linux gets plain --watch
  const watchArgs = process.platform === 'linux' ? ['--watch'] : ['--watch-path', serverDist, '--watch-path', sdkDist]
  run(process.execPath, noWatch ? [entry] : [...watchArgs, entry], env)
}

async function web() {
  // next dev silently hops to 3001 when 3000 is taken; msal redirects and the api rewrites
  // assume 3000, fail fast instead
  if (await probePort(3000)) {
    fail('port 3000 in use, the web dev server needs it')
  }
  // next dev also reads PORT (same convention as the api server); pin it to 3000 here and
  // hand the real api port to next's rewrites() via CONDUIT_API_PORT instead, so the two
  // dev servers don't race for the same port
  const env = { ...process.env, ...devEnv, PORT: '3000', CONDUIT_API_PORT: apiPort }
  run('pnpm --filter @conduit-mcp/web dev', null, env)
}

if (target === 'server') {
  await server()
} else if (target === 'web') {
  await web()
} else {
  fail('usage: node scripts/dev.mjs server [--no-watch] | node scripts/dev.mjs web')
}
