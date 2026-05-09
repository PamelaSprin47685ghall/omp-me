import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

function getShimDir() {
  const raw = import.meta.url;
  const idx = raw.lastIndexOf('/shim.mjs');
  if (idx === -1) throw new Error('Cannot locate shim.mjs: ' + raw);

  let dir = raw.slice(0, idx);
  if (dir.startsWith('file:///')) dir = dir.slice(8);
  else if (dir.startsWith('file://')) dir = dir.slice(7);
  else if (dir.startsWith('file:/')) dir = dir.slice(6);
  if (dir.startsWith('omp-legacy-pi-file:')) dir = dir.slice('omp-legacy-pi-file:'.length);

  // Windows /C:/Users/... → C:/Users/...
  if (/^\/[A-Za-z]:/.test(dir)) dir = dir.slice(1);

  return dir;
}

const shimDir = getShimDir();
const PLUGIN_URL = pathToFileURL(resolve(shimDir, 'index.js')).href;

// 诊断
try {
  const { appendFileSync } = await import('node:fs');
  appendFileSync('/tmp/squad-shim.log', [
    `import.meta.url: ${import.meta.url}`,
    `shimDir       : ${shimDir}`,
    `resolve+url   : ${PLUGIN_URL}`,
    '',
  ].join('\n'));
} catch {}

const mod = await import(PLUGIN_URL);
export default mod.default;
