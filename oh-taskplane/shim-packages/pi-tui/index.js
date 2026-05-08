/**
 * Shim: @mariozechner/pi-tui — re-exports oh-my-pi's TUI components
 * from the global install location (AGENTS.md file:// pattern).
 *
 * Same approach as advisor: `homedir()/.bun/install/global/node_modules/...`
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

const TUI_PATH = join(homedir(), '.bun/install/global/node_modules/@oh-my-pi/pi-tui/src/index.ts');

const _mod = await import('file://' + TUI_PATH);

export const Container = _mod.Container;
export const SelectList = _mod.SelectList;
export const SettingsList = _mod.SettingsList;
export const Text = _mod.Text;
export const truncateToWidth = _mod.truncateToWidth;
