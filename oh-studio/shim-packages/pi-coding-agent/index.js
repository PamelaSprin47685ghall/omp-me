/**
 * Shim: @mariozechner/pi-coding-agent — re-exports from oh-my-pi's global
 * install, same AGENTS.md file:// pattern as the oh-taskplane shim.
 *
 * DynamicBorder and getSettingsListTheme: imported from oh-my-pi's source.
 * At runtime, Bun returns the already-cached module (with theme initialized
 * by oh-my-pi's startup), so `theme.boxSharp` and `theme.fg()` are available
 * when these components are actually rendered inside ctx.ui.custom().
 *
 * getAgentDir: imported from oh-my-pi's pi-utils package. pi-studio uses
 * this to locate the persistent state storage directory.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

const BASE = join(homedir(), '.bun/install/global/node_modules/@oh-my-pi');

// DynamicBorder — render() accesses theme.boxSharp at call time, by then
// oh-my-pi's session_start has already initialized the theme cache.
const DB_PATH = join(BASE, 'pi-coding-agent/src/modes/components/dynamic-border.ts');
const _dbMod = await import('file://' + DB_PATH);

// getSettingsListTheme — same caching principle.
const THEME_PATH = join(BASE, 'pi-coding-agent/src/modes/theme/theme.ts');
const _themeMod = await import('file://' + THEME_PATH);

// getAgentDir from pi-utils
const UTILS_PATH = join(BASE, 'pi-utils/src/dirs.ts');
const _utilsMod = await import('file://' + UTILS_PATH);

export const DynamicBorder = _dbMod.DynamicBorder;
export const getSettingsListTheme = _themeMod.getSettingsListTheme;
export const getAgentDir = _utilsMod.getAgentDir;
