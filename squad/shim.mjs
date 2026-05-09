import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

function getShimDir() {
  const raw = import.meta.url;
  const idx = raw.lastIndexOf('/shim.mjs');
  if (idx === -1) throw new Error('Cannot locate shim.mjs: ' + raw);

  let dir = raw.slice(0, idx);

  // omp-legacy-pi-file: namespace wraps as file:///omp-legacy-pi-file:/real/path
  // Find it anywhere in the string (not just at start)
  const LEGACY_PREFIX = 'omp-legacy-pi-file:';
  const nsIdx = dir.indexOf(LEGACY_PREFIX);
  if (nsIdx !== -1) {
    dir = dir.slice(nsIdx + LEGACY_PREFIX.length);
  } else if (dir.startsWith('file://')) {
    dir = dir.slice(7);
  } else if (dir.startsWith('file:/')) {
    dir = dir.slice(5);
  }

  // Strip extra leading / before Windows drive letter (e.g., /C: → C:)
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
