/**
 * Contract Validator — AgentToolResult shape enforcement.
 *
 * Every tool execute() and side-effect handler in the squad-tau system
 * MUST return { content: TextContent[], isError?: boolean }.
 * No thrown exceptions escape to the OMP runtime.
 *
 * Usage:
 *   import { assertAgentToolResult } from '../helpers/contract-validator.js';
 *   const result = await tool.execute(...);
 *   assertAgentToolResult(result);
 *
 *   import { assertNeverThrows } from '../helpers/contract-validator.js';
 *   await assertNeverThrows(() => tool.execute(...));
 */
import assert from 'node:assert/strict';

/**
 * Assert a value conforms to the AgentToolResult contract.
 * { content: Array<{ type: 'text', text: string }>, isError?: boolean }
 */
export function assertAgentToolResult(result) {
    assert.ok(result !== null && result !== undefined, 'AgentToolResult must not be null/undefined');
    assert.ok(typeof result === 'object', 'AgentToolResult must be an object');
    assert.ok(Array.isArray(result.content), 'AgentToolResult.content must be an array');
    // content MAY be empty when display:false (tools return no user-facing text)
    for (let i = 0; i < result.content.length; i++) {
        const c = result.content[i];
        assert.ok(c !== null && typeof c === 'object', `content[${i}] must be an object`);
        assert.equal(c.type, 'text', `content[${i}].type must be 'text'`);
        assert.equal(typeof c.text, 'string', `content[${i}].text must be a string`);
    }
    if (result.isError !== undefined) {
        assert.equal(typeof result.isError, 'boolean', 'AgentToolResult.isError must be boolean when present');
    }
}

/**
 * Assert that an async function NEVER throws — it must always return
 * a structured AgentToolResult, even on error paths.
 */
export async function assertNeverThrows(fn) {
    let result;
    try {
        result = await fn();
    } catch (e) {
        assert.fail(`execute must not throw, got: ${e.message}`);
    }
    return result;
}

/**
 * Assert a tool definition has the correct shape.
 */
export function assertToolDefinition(tool, expectedName) {
    assert.ok(tool, `Tool "${expectedName}" must be defined`);
    assert.equal(tool.name, expectedName, `Tool name must be "${expectedName}"`);
    assert.equal(typeof tool.execute, 'function', `Tool "${expectedName}".execute must be a function`);
    assert.ok(tool.parameters, `Tool "${expectedName}".parameters must be defined`);
    assert.ok(tool.parameters.properties, `Tool "${expectedName}".parameters.properties must be defined`);
}

/**
 * Assert an execute result indicates error.
 */
export function assertIsError(result, expectedTextPattern) {
    assertAgentToolResult(result);
    assert.equal(result.isError, true, 'Expected isError=true');
    if (expectedTextPattern) {
        const text = result.content[0].text;
        assert.ok(
            text.includes(expectedTextPattern),
            `Expected error text to include "${expectedTextPattern}", got: "${text}"`,
        );
    }
}

/**
 * Assert an execute result indicates success (no error).
 */
export function assertIsSuccess(result) {
    assertAgentToolResult(result);
    if (result.isError !== undefined) {
        assert.equal(result.isError, false, 'Expected isError=false or absent');
    }
}
