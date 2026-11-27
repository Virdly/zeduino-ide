import { build, context } from 'esbuild'

const watch = process.argv.includes('--watch')
const opts = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: true,
  external: ['electron'],
  outdir: 'dist',
  entryPoints: {
    'main/index': 'src/main/index.ts',
    'preload/index': 'src/preload/index.ts',
  },
  loader: { '.node': 'file' },
  logLevel: 'info',
}

if (watch) {
  const ctx = await context(opts)
  await ctx.watch()
  console.log('[main] watching for changes')
} else {
  await build(opts)
}
