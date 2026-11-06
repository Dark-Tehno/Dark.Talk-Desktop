// Bundles main / preload / renderer with esbuild into ./dist
import { build } from 'esbuild';
import fs from 'node:fs';

fs.rmSync('dist', { recursive: true, force: true });
fs.mkdirSync('dist', { recursive: true });

const common = { bundle: true, sourcemap: true, logLevel: 'info' };

await build({
  ...common,
  entryPoints: ['src/main/main.ts'],
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outfile: 'dist/main.js',
  external: ['electron', 'bufferutil', 'utf-8-validate'],
});

await build({
  ...common,
  entryPoints: ['src/preload/preload.ts'],
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outfile: 'dist/preload.js',
  external: ['electron'],
});

await build({
  ...common,
  entryPoints: ['src/renderer/app.ts'],
  platform: 'browser',
  target: 'es2022',
  format: 'iife',
  outfile: 'dist/renderer.js',
});

fs.copyFileSync('src/renderer/index.html', 'dist/index.html');
fs.copyFileSync('src/renderer/styles.css', 'dist/styles.css');
console.log('build ok');
