/**
 * Shim: @mariozechner/pi-coding-agent — re-exports from oh-my-pi's global
 * install. Provides DynamicBorder for advisor-ui.ts and convertToLlm for
 * the advisor tool's conversation-branch serialization.
 */

import { join } from 'node:path';
import { getPiBase } from '@oh-my-pi/resolve-pi';

const BASE = getPiBase();

const DB_PATH = join(BASE, 'pi-coding-agent/src/modes/components/dynamic-border.ts');
const _dbMod = await import('file://' + DB_PATH);

const MSG_PATH = join(BASE, 'pi-coding-agent/src/session/messages.ts');
const _msgMod = await import('file://' + MSG_PATH);

const SETTINGS_PATH = join(BASE, 'pi-coding-agent/src/config/settings.ts');
const _settingsMod = await import('file://' + SETTINGS_PATH);

const EXT_TYPES_PATH = join(BASE, 'pi-coding-agent/src/extensibility/extensions/types.ts');
const _extTypesMod = await import('file://' + EXT_TYPES_PATH);

const UTILS_PATH = join(BASE, 'pi-utils/src/dirs.ts');
const _utilsMod = await import('file://' + UTILS_PATH);

export const DynamicBorder = _dbMod.DynamicBorder;
export const convertToLlm = _msgMod.convertToLlm;
export const isToolCallEventType = _extTypesMod.isToolCallEventType;
export const getAgentDir = _utilsMod.getAgentDir;
export const Settings = _settingsMod.Settings;

// pi-rtk-optimizer imports getSettingsListTheme from pi-coding-agent.
// The upstream implementation references a runtime theme singleton that's
// uninitialized until the TUI starts, so we provide a safe wrapper that
// lazily calls the real function (now live inside the TUI session).
// When called during /rtk command handling, the theme IS initialized.
const THEME_PATH = join(BASE, 'pi-coding-agent/src/modes/theme/theme.ts');
const _themeMod = await import('file://' + THEME_PATH);

export function getSettingsListTheme() {
    try {
        return _themeMod.getSettingsListTheme();
    } catch (e) {
        // theme singleton not ready — provide a minimal fallback
        const { Ellipsis } = _themeMod;
        return {
            label: (text, selected) => (selected ? `\x1b[1;36m${text}\x1b[0m` : text),
            value: (text, selected) => (selected ? `\x1b[36m${text}\x1b[0m` : `\x1b[90m${text}\x1b[0m`),
            description: (text) => `\x1b[90m${text}\x1b[0m`,
            cursor: `\x1b[36m▶\x1b[0m `,
            hint: (text) => `\x1b[90m${text}\x1b[0m`,
            // Some consumers expect Ellipsis to be available on theme
            ellipsis: Ellipsis ?? { Unicode: 0, Ascii: 1, Omit: 2 },
        };
    }
}

// Also re-export Ellipsis from theme so shim consumers can use it
export const Ellipsis = _themeMod.Ellipsis ?? { Unicode: 0, Ascii: 1, Omit: 2 };
