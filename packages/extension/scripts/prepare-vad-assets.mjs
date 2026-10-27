import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Copy Silero + ONNX runtime assets into public/vad so the extension can load
 * them via chrome.runtime.getURL('vad/'). Generated, never committed.
 */
const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const out = join(here, '..', 'public', 'vad');
mkdirSync(out, { recursive: true });

const vadRoot = dirname(require.resolve('@ricky0123/vad-web/package.json'));
const vadDist = join(vadRoot, 'dist');
for (const file of ['silero_vad_v5.onnx', 'vad.worklet.bundle.min.js']) {
  const source = join(vadDist, file);
  if (!existsSync(source)) throw new Error(`Missing VAD asset: ${source}`);
  copyFileSync(source, join(out, file));
}

const candidates = [
  // pnpm: sibling inside the same virtual store directory
  join(vadRoot, '..', '..', 'onnxruntime-web', 'dist'),
  join(vadRoot, 'node_modules', 'onnxruntime-web', 'dist'),
];
try {
  const resolved = dirname(require.resolve('onnxruntime-web', { paths: [vadRoot] }));
  candidates.unshift(resolved.endsWith('dist') ? resolved : join(resolved, 'dist'));
} catch {
  // Fall through to the filesystem candidates.
}
const ortDist = candidates.find((candidate) => existsSync(candidate));
if (!ortDist)
  throw new Error(`Cannot locate onnxruntime-web dist (tried ${candidates.join(', ')})`);
let copied = 0;
for (const file of readdirSync(ortDist)) {
  if (/^ort-wasm.*\.(wasm|mjs)$/.test(file)) {
    copyFileSync(join(ortDist, file), join(out, file));
    copied += 1;
  }
}
console.log(`VAD assets ready: ${copied} onnxruntime files + silero model + worklet`);
