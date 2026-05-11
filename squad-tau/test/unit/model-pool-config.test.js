import { describe, it, beforeEach, afterEach } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { loadModelsConfig, saveModelsConfig, CONFIG_PATH } from '../../server/model-pool-config.js';

describe('model-pool-config', () => {
    let originalContent = null;
    let originalExists = false;

    beforeEach(() => {
        const dir = path.dirname(CONFIG_PATH);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        originalExists = fs.existsSync(CONFIG_PATH);
        if (originalExists) {
            originalContent = fs.readFileSync(CONFIG_PATH, 'utf8');
        }
    });

    afterEach(() => {
        if (originalExists && originalContent !== null) {
            const dir = path.dirname(CONFIG_PATH);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(CONFIG_PATH, originalContent, 'utf8');
        } else if (!originalExists && fs.existsSync(CONFIG_PATH)) {
            fs.unlinkSync(CONFIG_PATH);
        }
    });

    it('loadModelsConfig returns [] for missing file', () => {
        if (fs.existsSync(CONFIG_PATH)) {
            fs.unlinkSync(CONFIG_PATH);
        }
        const config = loadModelsConfig();
        assert.deepEqual(config, []);
    });

    it('loadModelsConfig parses valid TOML and maps fields', () => {
        const toml = `
[[slot]]
provider = "openai"
model_id = "gpt-4"
role = "worker"
thinking_level = "high"

[[slot]]
provider = "anthropic"
model_id = "claude-3"
role = "reviewer"
`;
        fs.writeFileSync(CONFIG_PATH, toml, 'utf8');

        const config = loadModelsConfig();
        assert.deepEqual(config, [
            { provider: 'openai', modelId: 'gpt-4', role: 'worker', thinkingLevel: 'high' },
            { provider: 'anthropic', modelId: 'claude-3', role: 'reviewer', thinkingLevel: undefined },
        ]);
    });

    it('loadModelsConfig returns [] for malformed TOML', () => {
        fs.writeFileSync(CONFIG_PATH, '{ invalid toml', 'utf8');

        const config = loadModelsConfig();
        assert.deepEqual(config, []);
    });

    it('saveModelsConfig writes correct TOML to disk', () => {
        const testConfig = [
            { provider: 'openai', modelId: 'gpt-4', role: 'worker', thinkingLevel: 'high' },
            { provider: 'anthropic', modelId: 'claude-3', role: 'reviewer' },
        ];

        saveModelsConfig(testConfig);

        assert.ok(fs.existsSync(CONFIG_PATH));
        const content = fs.readFileSync(CONFIG_PATH, 'utf8');
        const parsed = Bun.TOML.parse(content);
        assert.deepEqual(parsed.slot, [
            { provider: 'openai', model_id: 'gpt-4', role: 'worker', thinking_level: 'high' },
            { provider: 'anthropic', model_id: 'claude-3', role: 'reviewer' },
        ]);
    });

    it('saveModelsConfig omits thinking_level when empty', () => {
        const testConfig = [
            { provider: 'openai', modelId: 'gpt-4', role: 'worker', thinkingLevel: '' },
            { provider: 'anthropic', modelId: 'claude-3', role: 'reviewer', thinkingLevel: undefined },
        ];

        saveModelsConfig(testConfig);

        const content = fs.readFileSync(CONFIG_PATH, 'utf8');
        assert.ok(!content.includes('thinking_level'));
        const parsed = Bun.TOML.parse(content);
        assert.deepEqual(parsed.slot, [
            { provider: 'openai', model_id: 'gpt-4', role: 'worker' },
            { provider: 'anthropic', model_id: 'claude-3', role: 'reviewer' },
        ]);
    });

    it('saveModelsConfig creates parent directory', () => {
        const dir = path.dirname(CONFIG_PATH);
        if (fs.existsSync(dir)) {
            fs.rmSync(dir, { recursive: true, force: true });
        }

        const testConfig = [{ provider: 'test', modelId: 'test-1', role: 'worker' }];
        saveModelsConfig(testConfig);

        assert.ok(fs.existsSync(CONFIG_PATH));
        const content = fs.readFileSync(CONFIG_PATH, 'utf8');
        const parsed = Bun.TOML.parse(content);
        assert.deepEqual(parsed.slot, [{ provider: 'test', model_id: 'test-1', role: 'worker' }]);
    });
});
