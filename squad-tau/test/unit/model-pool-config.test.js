import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { loadModelsConfig, saveModelsConfig, CONFIG_PATH } from '../../server/model-pool-config.js';

describe('model-pool-config', () => {
    let originalContent = null;
    let originalExists = false;

    beforeEach(() => {
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

    it('loadModelsConfig parses valid JSON', () => {
        const testConfig = [
            { id: 'model-1', name: 'GPT-4', endpoint: 'https://api.openai.com' },
            { id: 'model-2', name: 'Claude', endpoint: 'https://api.anthropic.com' },
        ];
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(testConfig), 'utf8');

        const config = loadModelsConfig();
        assert.deepEqual(config, testConfig);
    });

    it('loadModelsConfig returns [] for malformed JSON', () => {
        fs.writeFileSync(CONFIG_PATH, '{ invalid json', 'utf8');

        const config = loadModelsConfig();
        assert.deepEqual(config, []);
    });

    it('saveModelsConfig writes correct JSON to disk', () => {
        const testConfig = [{ id: 'model-1', name: 'GPT-4', endpoint: 'https://api.openai.com' }];

        saveModelsConfig(testConfig);

        assert.ok(fs.existsSync(CONFIG_PATH));
        const content = fs.readFileSync(CONFIG_PATH, 'utf8');
        const parsed = JSON.parse(content);
        assert.deepEqual(parsed, testConfig);

        assert.ok(content.includes('  '), 'JSON should be formatted with 2-space indent');
    });

    it('saveModelsConfig creates parent directory', () => {
        const dir = path.dirname(CONFIG_PATH);
        if (fs.existsSync(dir)) {
            fs.rmSync(dir, { recursive: true, force: true });
        }

        const testConfig = [{ id: 'test', name: 'Test Model' }];
        saveModelsConfig(testConfig);

        assert.ok(fs.existsSync(CONFIG_PATH));
        const content = fs.readFileSync(CONFIG_PATH, 'utf8');
        const parsed = JSON.parse(content);
        assert.deepEqual(parsed, testConfig);
    });
});
