import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

const pExecFile = promisify(execFile)

export type ExecFn = (
  cmd: string,
  args: string[],
  opts?: { cwd?: string; shell?: boolean },
) => Promise<{ stdout: string }>

export const defaultExec: ExecFn = async (cmd, args, opts = {}) => {
  const { stdout } = await pExecFile(cmd, args, {
    cwd: opts.cwd,
    timeout: 120_000,
    windowsHide: true,
    shell: opts.shell,
  })
  return { stdout }
}

export async function resolveCommit(repoUrl: string, ref: string | undefined, exec: ExecFn): Promise<string> {
  const { stdout } = await exec('git', ['ls-remote', repoUrl, ref ?? 'HEAD'])
  const sha = stdout.split(/\s/)[0]
  if (!sha) {
    throw new Error(`no commit found for ref ${ref ?? 'HEAD'} at ${repoUrl}`)
  }
  return sha
}

export async function cloneAtCommit(repoUrl: string, commit: string, destDir: string, exec: ExecFn): Promise<void> {
  // full clone then detach: shallow fetch-by-sha is not universally allowed, optimize later
  await exec('git', ['clone', repoUrl, destDir])
  await exec('git', ['-C', destDir, 'checkout', '--detach', commit])
}

export async function installProdDeps(dir: string, exec: ExecFn): Promise<boolean> {
  let pkg: { dependencies?: Record<string, string> }
  try {
    pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')) as { dependencies?: Record<string, string> }
  } catch {
    return false
  }
  if (!pkg.dependencies || Object.keys(pkg.dependencies).length === 0) {
    return false
  }
  await exec('pnpm', ['install', '--prod', '--ignore-scripts', '--dir', dir], { shell: process.platform === 'win32' })
  return true
}
