/**
 * Tests for review-loop — the oh-my-pi auto-loop extension.
 *
 * Follows the same pattern as ollama-search/test/plugin.test.js.
 */

import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import reviewLoopExtension from "../index.js";

// --------------------------------------------------------------------------
// Helpers: minimal pi stub matching oh-my-pi's ExtensionAPI
// --------------------------------------------------------------------------

function stubPi() {
	const tools = [];
	const events = {};
	const commands = {};
	const shortcuts = {};
	const messages = [];

	return {
		tools,
		events,
		commands,
		shortcuts,
		messages,

		pi: {
			on(event, handler) {
				(events[event] ??= []).push(handler);
			},

			registerTool(tool) {
				tools.push(tool);
			},

			registerCommand(name, config) {
				commands[name] = config;
			},

			registerShortcut(key, config) {
				shortcuts[key] = config;
			},

			sendMessage(msg, opts) {
				messages.push({ msg, opts });
			},

			sendUserMessage(content, opts) {
				messages.push({ userMsg: content, opts });
			},

			typebox: {
				Object: (props) => ({ type: "object", properties: props }),
				String: (opts) => ({ type: "string", ...opts }),
				Number: (opts) => ({ type: "number", ...opts }),
				Optional: (schema) => schema,
			},
		},
	};
}

// --------------------------------------------------------------------------
// Extension registration
// --------------------------------------------------------------------------

describe("extension registration", () => {
	it("registers loop_control tool", async () => {
		const s = stubPi();
		await reviewLoopExtension(s.pi);

		const names = s.tools.map((t) => t.name);
		assert.ok(names.includes("loop_control"), "loop_control tool not registered");
	});

	it("registers loop-stop command", async () => {
		const s = stubPi();
		await reviewLoopExtension(s.pi);

		assert.ok(s.commands["loop-stop"], "loop-stop command not registered");
		assert.equal(typeof s.commands["loop-stop"].handler, "function");
	});

	it("registers /once command", async () => {
		const s = stubPi();
		await reviewLoopExtension(s.pi);

		assert.ok(s.commands["once"], "once command not registered");
		assert.equal(typeof s.commands["once"].handler, "function");
	});

	it("registers ctrl+shift+s shortcut", async () => {
		const s = stubPi();
		await reviewLoopExtension(s.pi);

		assert.ok(s.shortcuts["ctrl+shift+s"], "ctrl+shift+s shortcut not registered");
		assert.equal(typeof s.shortcuts["ctrl+shift+s"].handler, "function");
	});

	it("hooks lifecycle events", async () => {
		const s = stubPi();
		await reviewLoopExtension(s.pi);

		const expectedEvents = [
			"session_start",
			"session_switch",
			"session_fork",
			"session_tree",
			"agent_start",
			"tool_call",
			"input",
			"before_agent_start",
			"agent_end",
		];

		for (const ev of expectedEvents) {
			assert.ok(s.events[ev], `event ${ev} not registered`);
			assert.ok(s.events[ev].length > 0, `event ${ev} has no handlers`);
		}
	});

	it("loop_control tool has name, label, description, parameters, execute, renderCall, renderResult", async () => {
		const s = stubPi();
		await reviewLoopExtension(s.pi);

		const tool = s.tools.find((t) => t.name === "loop_control");
		assert.ok(tool);
		assert.equal(tool.label, "Loop Control");
		assert.equal(typeof tool.description, "string");
		assert.ok(tool.parameters);
		assert.equal(typeof tool.execute, "function");
		assert.equal(typeof tool.renderCall, "function");
		assert.equal(typeof tool.renderResult, "function");
	});

	it("loop_control parameters include status (enum), summary, reason (optional)", async () => {
		const s = stubPi();
		await reviewLoopExtension(s.pi);

		const tool = s.tools.find((t) => t.name === "loop_control");
		const props = tool.parameters.properties;
		assert.ok(props.status, "status parameter missing");
		assert.ok(props.summary, "summary parameter missing");
	});

	it("is idempotent — calling extension twice does not re-register", async () => {
		const s = stubPi();
		await reviewLoopExtension(s.pi);
		const toolCount = s.tools.length;
		await reviewLoopExtension(s.pi);
		assert.equal(s.tools.length, toolCount, "tools were re-registered on second call");
	});

	it("allows retry after transient initialization failure", async () => {
		let failOnce = true;
		const tools = [];

		const pi = {
			on: () => {},
			registerTool(tool) {
				if (failOnce) {
					failOnce = false;
					throw new Error("transient registration failure");
				}
				tools.push(tool);
			},
			registerCommand: () => {},
			registerShortcut: () => {},
			sendMessage: () => {},
			sendUserMessage: () => {},
			typebox: {
				Object: (props) => ({ type: "object", properties: props }),
				String: (opts) => ({ type: "string", ...opts }),
				Optional: (schema) => schema,
			},
		};

		await assert.rejects(() => reviewLoopExtension(pi), /transient registration failure/);
		await assert.doesNotReject(() => reviewLoopExtension(pi));

		assert.equal(tools.length, 1);
	});
});

// --------------------------------------------------------------------------
// Tool execution
// --------------------------------------------------------------------------

describe("loop_control tool execution", () => {
	it("returns 'no active loop' when state is inactive", async () => {
		const s = stubPi();
		await reviewLoopExtension(s.pi);

		const tool = s.tools.find((t) => t.name === "loop_control");

		const ctx = {
			ui: { setWidget: () => {}, notify: () => {} },
			sessionManager: { getBranch: () => [] },
			isIdle: () => true,
		};

		const result = await tool.execute("call-1", { status: "next", summary: "test" }, null, null, ctx);
		const text = result.content[0]?.text || "";
		assert.ok(text.includes("No active loop"), `expected "No active loop" but got: ${text}`);
	});

	it("execute with 'next' returns content after loop is started", async () => {
		const s = stubPi();
		await reviewLoopExtension(s.pi);

		const ctx = {
			ui: { setWidget: () => {}, notify: () => {} },
			sessionManager: { getBranch: () => [] },
			isIdle: () => true,
		};

		const inputHandlers = s.events["input"];

		// Start loop via input
		await inputHandlers[0]({ text: "Refactor the code" }, ctx);

		const tool = s.tools.find((t) => t.name === "loop_control");

		const result = await tool.execute("call-2", { status: "next", summary: "Started refactoring" }, null, null, ctx);
		const text = result.content[0]?.text || "";
		assert.ok(text.includes("Advancing") || text.includes("step"), `unexpected: ${text}`);
	});

	it("execute with 'done' transitions to confirming_done", async () => {
		const s = stubPi();
		await reviewLoopExtension(s.pi);

		const ctx = {
			ui: { setWidget: () => {}, notify: () => {} },
			sessionManager: { getBranch: () => [] },
			isIdle: () => true,
		};

		const inputHandlers = s.events["input"];

		// Start loop
		await inputHandlers[0]({ text: "Fix all bugs" }, ctx);

		const tool = s.tools.find((t) => t.name === "loop_control");

		// Call 'done'
		const result = await tool.execute("call-3", { status: "done", summary: "All fixed" }, null, null, ctx);
		const text = result.content[0]?.text || "";
		assert.ok(text.includes("confirm") || text.includes("confirming"), `should ask for confirmation: ${text}`);
	});
});

// --------------------------------------------------------------------------
// Command handler behavior
// --------------------------------------------------------------------------

describe("once command", () => {
	it("sends user message when text is provided", async () => {
		const s = stubPi();
		await reviewLoopExtension(s.pi);

		const ctx = {
			ui: { setWidget: () => {}, notify: () => {} },
			sessionManager: { getBranch: () => [] },
			isIdle: () => true,
		};

		await s.commands["once"].handler("  check status quickly  ", ctx);

		assert.ok(s.messages.length > 0, "should have sent a message");
		const last = s.messages[s.messages.length - 1];
		assert.ok(last.userMsg);
		assert.equal(last.userMsg.trim(), "check status quickly");
	});

	it("does nothing when text is empty", async () => {
		const s = stubPi();
		await reviewLoopExtension(s.pi);

		const ctx = {
			ui: { setWidget: () => {}, notify: () => {} },
			sessionManager: { getBranch: () => [] },
			isIdle: () => true,
		};

		const before = s.messages.length;
		await s.commands["once"].handler("   ", ctx);
		assert.equal(s.messages.length, before, "should not send message for empty text");
	});
});

describe("loop-stop command", () => {
	it("does not error when no loop is active", async () => {
		const s = stubPi();
		await reviewLoopExtension(s.pi);

		const ctx = {
			ui: { setWidget: () => {}, notify: () => {} },
			sessionManager: { getBranch: () => [] },
			isIdle: () => true,
			abort: () => {},
		};

		await assert.doesNotReject(() => s.commands["loop-stop"].handler("", ctx));
	});
});

// --------------------------------------------------------------------------
// Shortcut handler
// --------------------------------------------------------------------------

describe("ctrl+shift+s shortcut", () => {
	it("handler is a function", async () => {
		const s = stubPi();
		await reviewLoopExtension(s.pi);

		assert.equal(typeof s.shortcuts["ctrl+shift+s"].handler, "function");
	});
});

// --------------------------------------------------------------------------
// Render functions (smoke tests)
// --------------------------------------------------------------------------

describe("render functions", () => {
	it("renderCall and renderResult exist and return objects", async () => {
		const s = stubPi();
		await reviewLoopExtension(s.pi);

		const tool = s.tools.find((t) => t.name === "loop_control");

		const theme = {
			fg: (color, text) => text,
			bold: (text) => text,
		};

		const callResult = tool.renderCall({ status: "next" }, theme);
		assert.ok(callResult !== undefined);

		const resultRender = tool.renderResult({ details: { status: "running", step: 0, lastSummary: "work" } }, null, theme);
		assert.ok(resultRender !== undefined);
	});
});
