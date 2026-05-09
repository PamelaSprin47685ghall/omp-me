import { homedir } from 'node:os';
import { join } from 'node:path';

const PLUGIN_DIR = join(homedir(), 'omp-me', 'oh-rpiv-advisor');
const PLUGIN_URL = 'file:///' + PLUGIN_DIR.replace(/\\/g, '/') + '/index.js';

const mod = await import(PLUGIN_URL);
export default mod.default;
