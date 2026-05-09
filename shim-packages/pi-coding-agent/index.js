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

export const DynamicBorder = _dbMod.DynamicBorder;
export const convertToLlm = _msgMod.convertToLlm;
