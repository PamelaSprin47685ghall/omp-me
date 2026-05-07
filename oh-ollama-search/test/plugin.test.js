/**
 * Tests for oh-ollama-search — the oh-my-pi adaptor for @ollama/pi-web-search.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("createBridge", () => {
	it("forwards registerTool", async () => {
		const { createBridge } = await import("../index.js");

		const tools = [];
		const pi = { registerTool: (t) => tools.push(t.name) };

		const bridge = createBridge(pi);
		bridge.registerTool({ name: "web_search" });
		bridge.registerTool({ name: "web_fetch" });

		assert.equal(tools.length, 2);
		assert.equal(tools[0], "web_search");
		assert.equal(tools[1], "web_fetch");
	});

	it("passes tool definition through unchanged", async () => {
		const { createBridge } = await import("../index.js");

		const defs = [];
		const pi = { registerTool: (t) => defs.push(t) };

		const bridge = createBridge(pi);
		const toolDef = {
			name: "web_search",
			label: "Web Search",
			description: "test",
			parameters: { type: "object", properties: {} },
			execute: async () => ({}),
		};
		bridge.registerTool(toolDef);

		assert.equal(defs.length, 1);
		assert.equal(defs[0], toolDef);
	});
});
