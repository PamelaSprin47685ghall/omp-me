import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('squad-engine dead code cleanup', () => {
    it('must not have dagResult dead variable', async () => {
        const fs = await import('fs');
        const src = fs.readFileSync('server/squad-engine.js', 'utf8');
        assert.ok(!src.includes('dagResult'), 'dagResult was removed (dead variable)');
    });

    it('executeDAG wrapper must use destructured parameter', async () => {
        const fs = await import('fs');
        const src = fs.readFileSync('server/squad-engine.js', 'utf8');
        // The wrapper should destructure { nodes } from the parameter
        const match = src.match(/executeDAG:\s*async\s*\(\s*\{[^}]*nodes[^}]*\}\s*\)/);
        assert.ok(match, 'executeDAG wrapper must use destructured { nodes } parameter');
    });
});
