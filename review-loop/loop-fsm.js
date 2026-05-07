/**
 * LoopFSM — state machine driving the review loop.
 */

import { emptyState, isInactiveOrDone, transition } from './state.js';
import { buildPrompt, buildConfirmMessage, buildFallbackMessage, updateWidget } from './messages.js';
import { handleLoopControlTool } from './tool.js';

export default class LoopFSM {
    constructor(pi) {
        this.pi = pi;
        this.state = emptyState();
        this.agentLoopAction = 'none';
        this.sawAnyNonLoopTool = false;
        this.skipNextAutoLoop = false;
    }

    /** True when extension runs inside a task-spawned subagent — skip all loop behavior. */
    #isSubagent() {
        try {
            return this.pi.getActiveTools().includes('yield');
        } catch {
            return false;
        }
    }

    reconstruct(ctx) {
        if (this.#isSubagent()) return;
        if (!isInactiveOrDone(this.state)) return;
        let s = emptyState();
        for (const entry of ctx.sessionManager.getBranch()) {
            if (
                entry.type === 'message' &&
                entry.message.role === 'toolResult' &&
                entry.message.toolName === 'loop_control'
            ) {
                const d = entry.message.details;
                if (d) s = { ...d };
            }
        }
        this.dispatch({ type: 'reconstruct', state: s }, ctx);
    }

    onAgentStart() {
        if (this.#isSubagent()) return;
        if (isInactiveOrDone(this.state)) return;
        this.agentLoopAction = 'none';
        this.sawAnyNonLoopTool = false;
    }

    onToolCall(event) {
        if (this.#isSubagent()) return;
        if (isInactiveOrDone(this.state)) return;
        if (event.toolName && event.toolName !== 'loop_control') {
            this.sawAnyNonLoopTool = true;
        }
    }

    async executeTool(_id, params, _signal, _onUpdate, ctx) {
        if (this.#isSubagent()) {
            return { content: [{ type: 'text', text: 'No active loop.' }], details: { status: 'inactive' } };
        }
        this.agentLoopAction = params.status;
        const result = handleLoopControlTool(params, this.state);
        this.dispatch(this.resolveEvent(params), ctx);
        return { content: result.content, details: { ...this.state } };
    }

    resolveEvent(params) {
        const fromRunning = this.state.status === 'running';
        if (params.status === 'done') {
            return fromRunning
                ? { type: 'done_request', summary: params.summary }
                : { type: 'done_confirm', summary: params.summary };
        }
        return fromRunning
            ? { type: 'next_summary', summary: params.summary }
            : { type: 'continue', summary: params.summary };
    }

    async onBeforeAgentStart(event, ctx) {
        if (this.#isSubagent()) {
            await this.#ensureLoopControlRemoved();
            return;
        }
        const wasInactive = isInactiveOrDone(this.state);
        const skip = this.skipNextAutoLoop;
        this.skipNextAutoLoop = false;

        if (wasInactive && !skip) {
            const text = event.prompt.trim();
            if (text && !text.startsWith('/')) {
                this.state = transition(this.state, { type: 'start', goal: text }).state;
                updateWidget(this.state, ctx);
            }
        }
        if (isInactiveOrDone(this.state)) return;
        if (wasInactive && this.state.status === 'running' && !skip) {
            return { message: { customType: 'loop-iteration', content: buildPrompt(this.state), display: true } };
        }
    }

    async #ensureLoopControlRemoved() {
        try {
            const tools = this.pi.getActiveTools();
            if (tools.includes('loop_control')) {
                await this.pi.setActiveTools(tools.filter((t) => t !== 'loop_control'));
            }
        } catch {
            // Runtime not fully initialized yet — harmless
        }
    }

    async onAgentEnd(event, ctx) {
        if (this.#isSubagent()) return;
        if (isInactiveOrDone(this.state)) return;

        const lastAssistant = [...event.messages].reverse().find((m) => m.role === 'assistant');
        const wasAborted = lastAssistant?.stopReason === 'aborted';

        if (this.state.status === 'confirming') {
            if (wasAborted) {
                this.dispatch({ type: 'stop', reason: 'Interrupted by user' }, ctx);
                return;
            }
            this.dispatch({ type: 'silent_confirm' }, ctx);
            return;
        }

        if (wasAborted) {
            this.dispatch({ type: 'stop', reason: 'Interrupted by user' }, ctx);
            return;
        }
        if (this.agentLoopAction === 'next') {
            this.dispatch({ type: 'advance' }, ctx);
        } else if (this.agentLoopAction === 'done') {
            this.dispatch({ type: 'stop', reason: 'Goal complete' }, ctx);
        } else if (this.sawAnyNonLoopTool) {
            this.dispatch({ type: 'advance' }, ctx);
        } else {
            this.sendFallback();
        }
    }

    async onInput(event, ctx) {
        if (this.#isSubagent()) return {};
        const text = (event.text ?? '').trim();
        if (text.startsWith('/')) {
            if (text.startsWith('/once ') || text === '/once') {
                const argsText = text.startsWith('/once ') ? text.slice(6) : '';
                const trimmed = argsText.trim();
                if (trimmed) {
                    this.setSkipNextAutoLoop(true);
                    return { text: trimmed };
                }
                return { handled: true };
            }
            return {};
        }
        if (this.state.status === 'confirming') {
            this.dispatch({ type: 'stop', reason: 'Goal complete' }, ctx);
            return { handled: true };
        }
        if (this.state.status === 'running') return { text };
        if (!ctx.isIdle()) return { text };
        this.dispatch({ type: 'start', goal: text }, ctx);
        return { handled: true };
    }

    stop(ctx, reason) {
        if (this.#isSubagent()) return;
        if (isInactiveOrDone(this.state)) {
            ctx.ui.notify('No active loop', 'info');
            return;
        }
        this.dispatch({ type: 'stop', reason }, ctx);
        ctx.ui.notify(`Loop stopped after ${this.state.step + 1} iteration(s)`, 'warning');
    }

    setSkipNextAutoLoop(value) {
        this.skipNextAutoLoop = value;
    }

    async executeOnceCommand(args, ctx) {
        if (this.#isSubagent()) return;
        const text = args.trim();
        if (text) {
            this.setSkipNextAutoLoop(true);
            await this.pi.sendUserMessage(text, { deliverAs: ctx.isIdle() ? undefined : 'steer' });
        }
    }

    dispatch(event, ctx) {
        const { state: next, effects } = transition(this.state, event);
        this.state = next;
        updateWidget(this.state, ctx);
        if (effects.iteration) this.sendIteration();
        if (effects.confirmReminder) this.sendConfirmReminder();
    }

    sendIteration() {
        this.pi.sendMessage(
            { customType: 'loop-iteration', content: buildPrompt(this.state), display: true },
            { triggerTurn: true, deliverAs: 'nextTurn' },
        );
    }

    sendFallback() {
        this.pi.sendMessage(
            { customType: 'loop-fallback', content: buildFallbackMessage(), display: true },
            { triggerTurn: true, deliverAs: 'nextTurn' },
        );
    }

    sendConfirmReminder() {
        this.pi.sendMessage(
            { customType: 'loop-confirm', content: buildConfirmMessage(this.state), display: true },
            { triggerTurn: true, deliverAs: 'nextTurn' },
        );
    }
}
