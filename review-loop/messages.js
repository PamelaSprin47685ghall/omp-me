/**
 * Message builders and widget update for the review loop.
 */

export function buildPrompt(state) {
	const step = state.status !== "inactive" ? state.step : 0;
	const goal = state.status !== "inactive" ? state.goal : "unknown";
	return [
		`## Loop — Iteration ${step + 1}`,
		`Goal: ${goal}`,
		'Work toward the goal. When the goal is fully met, call loop_control with status "done" and explain why.',
		'If more work is needed, call loop_control with status "next" describing what\'s left.',
	].join("\n");
}

export function buildConfirmMessage(state) {
	return [
		"Please confirm that all work for the goal is completely done.",
		"",
		`Goal: ${state.goal}`,
		"",
		'If the goal is fully met, you MUST use the task tool to spawn a "reviewer" sub-agent with the following assignment (include the literal goal text):',
		"",
		`- Goal to review: ${state.goal}`,
		"- Check: 1) Code quality  2) Design defects  3) Code vulnerabilities  4) User experience  5) Whether the goal is fully completed",
		"",
		'Only call loop_control("done") if the review sub-agent confirms ALL checks pass.',
		'If the review finds any issues or the goal is not fully met, call loop_control("next") to continue working.',
	].join("\n");
}

export function buildNextMessage(state, summary) {
	return `→ Advancing to step ${state.step + 1}. Goal: ${state.goal}. Summary: ${summary}`;
}

export function buildDoneMessage(state, summary) {
	const reason = state.reasonDone || summary || "Goal complete";
	const s = summary || state.lastSummary || "(none)";
	return `✓ Loop complete after ${state.step + 1} iteration(s). Summary: ${s}. Reason: ${reason}`;
}

export function buildStatusMessage(state) {
	return `✓ Loop complete after ${state.step + 1} iteration(s).`;
}

export function buildFallbackMessage() {
	return "You stopped without calling `loop_control`. If the task is incomplete, continue working. If done, call `loop_control` with status 'done'.";
}

export function updateWidget(state, ctx) {
	if (state.status === "inactive" || state.status === "done") {
		ctx.ui.setWidget("loop", undefined);
		return;
	}
	ctx.ui.setWidget("loop", [
		"┌─ Loop ──────────",
		`│ 🔄 iteration ${state.step + 1}`,
		"└─ Ctrl+Shift+S to stop ─",
	]);
}
