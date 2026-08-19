import { createRequire } from 'node:module'
import { join } from 'node:path'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)

// resolve the host's sdk and zod so every plugin bundles the same module source (same version,
// not the same instance -- each plugin still inlines its own copy since bundle:true has no
// external. safe today because nothing does cross-boundary instanceof on an sdk-exported class
// require.resolve applies the sdk's "require" export condition, which always points at src --
// esbuild transpiles ts natively so plugins bundle straight from live sdk source, dist or not
function hostAliases(): Record<string, string> {
  return { '@conduit-mcp/plugin-sdk': require.resolve('@conduit-mcp/plugin-sdk'), zod: require.resolve('zod') }
}

export async function bundlePlugin(opts: { srcDir: string; entry: string; outFile: string }): Promise<void> {
  await build({
    entryPoints: [join(opts.srcDir, opts.entry)],
    outfile: opts.outFile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    alias: hostAliases(),
    logLevel: 'silent',
    // bundled cjs deps may call require at runtime
    banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  })
}
