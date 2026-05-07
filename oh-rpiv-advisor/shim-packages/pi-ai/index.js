/**
 * Shim: @mariozechner/pi-ai — re-exports from oh-my-pi's global install.
 *
 * completeSimple: the core LLM completion function, from pi-ai/src/stream.ts.
 *
 * getSupportedThinkingLevels: checks which reasoning-effort levels a model
 * supports by inspecting its ThinkingConfig.maxLevel.
 *
 * Types (Message, ThinkingLevel) are type-only imports in the consumer and
 * erased at runtime, so we don't need to re-export them.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

const BASE = join(homedir(), '.bun/install/global/node_modules/@oh-my-pi');

// completeSimple
const STREAM_PATH = join(BASE, 'pi-ai/src/stream.ts');
const _streamMod = await import('file://' + STREAM_PATH);

/**
 * Wrapped completeSimple — normalizes `systemPrompt` from string to string[].
 *
 * rpiv-advisor passes ADVISOR_SYSTEM_PROMPT as a single string, but
 * oh-my-pi's Context.systemPrompt expects string[].
 */
const _origCompleteSimple = _streamMod.completeSimple;
export async function completeSimple(model, context, options) {
    const ctx = {
        ...context,
        systemPrompt: typeof context.systemPrompt === 'string' ? [context.systemPrompt] : context.systemPrompt,
    };
    return _origCompleteSimple(model, ctx, options);
}

// The supported effort levels in canonical order
const BASE_EFFORT_LEVELS = ['minimal', 'low', 'medium', 'high'];
const XHIGH_EFFORT_LEVEL = 'xhigh';

/**
 * Returns the list of thinking/effort levels a model supports.
 * In oh-my-pi the model's `thinking` field (ThinkingConfig) exposes
 * minLevel / maxLevel; we derive the set from maxLevel.
 */
export function getSupportedThinkingLevels(model) {
    if (!model?.reasoning) return [];

    // No thinking config → default to base levels
    if (!model.thinking?.maxLevel) return [...BASE_EFFORT_LEVELS];

    const max = model.thinking.maxLevel;
    const all = [...BASE_EFFORT_LEVELS, XHIGH_EFFORT_LEVEL];
    const idx = all.indexOf(max);
    return idx >= 0 ? all.slice(0, idx + 1) : [...BASE_EFFORT_LEVELS];
}
