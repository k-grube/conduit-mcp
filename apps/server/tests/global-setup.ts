import { spawn, type ChildProcess } from 'node:child_process'
import { createRequire } from 'node:module'

let proc: ChildProcess

export async function setup() {
  const require = createRequire(import.meta.url)
  const bin = require.resolve('azurite/dist/src/azurite.js')
  proc = spawn(process.execPath, [bin, '--inMemoryPersistence', '--silent', '--tablePort', '10102'], {
    stdio: 'ignore',
  })
  process.env.AZURE_TABLES_CONNECTION_STRING =
    'DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;TableEndpoint=http://127.0.0.1:10102/devstoreaccount1;'
  // wait for the table endpoint to accept connections
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    try {
      await fetch('http://127.0.0.1:10102/devstoreaccount1/Tables', { method: 'GET' })
      return
    } catch {
      await new Promise((r) => setTimeout(r, 200))
    }
  }
  throw new Error('azurite did not start')
}

export async function teardown() {
  proc?.kill()
}
