import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

function getShimDir() {
  const raw = import.meta.url;
  const idx = raw.lastIndexOf('/shim.mjs');
  if (idx === -1) throw new Error('Cannot locate shim.mjs');

  let dir = raw.slice(0, idx);
  if (dir.startsWith('file://')) dir = dir.slice(7);
  else if (dir.startsWith('file:/')) dir = dir.slice(6);
  if (dir.startsWith('omp-legacy-pi-file:')) dir = dir.slice('omp-legacy-pi-file:'.length);

  // 移除 Windows 驱动器前缀前的额外 /
  if (/^\/[A-Za-z]:/.test(dir)) dir = dir.slice(1);

  return dir;
}

const PLUGIN_URL = pathToFileURL(resolve(getShimDir(), 'index.js')).href;
const mod = await import(PLUGIN_URL);
export default mod.default;
