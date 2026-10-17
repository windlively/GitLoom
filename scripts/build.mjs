import * as esbuild from 'esbuild';
import { mkdir } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
const watch = process.argv.includes('--watch');
const configurations = [
  {
    entryPoints: ['src/extension.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    external: ['vscode'],
    outfile: 'dist/extension.cjs',
    sourcemap: watch,
  },
  {
    entryPoints: ['webview/src/main.tsx'],
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: 'es2022',
    outfile: 'dist/webview.js',
    loader: { '.ttf': 'file' },
    assetNames: 'assets/[name]-[hash]',
    minify: !watch,
    sourcemap: watch,
  },
];
if (watch) {
  for (const config of configurations) {
    const context = await esbuild.context(config);
    await context.watch();
  }
  console.log('Watching extension and webview…');
} else {
  await Promise.all(configurations.map((config) => esbuild.build(config)));
}
