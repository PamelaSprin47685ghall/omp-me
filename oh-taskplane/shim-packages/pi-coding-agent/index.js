/**
 * Shim: @mariozechner/pi-coding-agent — re-exports from oh-my-pi's global
 * install, same AGENTS.md file:// pattern as the pi-tui shim.
 *
 * DynamicBorder and getSettingsListTheme are imported from oh-my-pi's
 * source. At runtime, Bun returns the already-cached module (with theme
 * initialized by oh-my-pi's startup), so `theme.boxSharp` and `theme.fg()`
 * are available when these components are actually rendered inside
 * ctx.ui.custom().
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

const BASE = join(homedir(), '.bun/install/global/node_modules/@oh-my-pi');

// Import DynamicBorder directly from its source file.
// Its `render()` accesses `theme.boxSharp` at call time — by then
// oh-my-pi's `session_start` has already initialized the theme,
// and Bun returns the cached module with populated exports.
const DB_PATH = join(BASE, 'pi-coding-agent/src/modes/components/dynamic-border.ts');
const _dbMod = await import('file://' + DB_PATH);

// Import getSettingsListTheme from the theme module directly.
// Same caching principle: oh-my-pi initializes `theme` before any
// extension command handler runs, so `theme.fg()` works when called.
const THEME_PATH = join(BASE, 'pi-coding-agent/src/modes/theme/theme.ts');
const _themeMod = await import('file://' + THEME_PATH);

export const DynamicBorder = _dbMod.DynamicBorder;
export const getSettingsListTheme = _themeMod.getSettingsListTheme;
