import fs from 'node:fs';
import path from 'node:path';

export const CAPS_INJECTION_SYMBOL = Symbol.for('kunwei.caps-injection');

const CAPS_FILE_RE = /^[A-Z][A-Z0-9_]*\.md$/;
const CAPS_DIR_RE = /^[A-Z][A-Z0-9_]*$/;
const EXCLUDED_FILE_NAMES = new Set(['CLAUDE.md', 'README.md']);
const EXCLUDED_DIR_NAMES = new Set([
    'CLAUDE', 'NODE_MODULES', '.GIT', 'TARGET', 'DIST', 'BUILD', 'OUT',
    '.VENV', 'VENV', '__PYCACHE__', '.CACHE', '.NEXT', '.TURBO', '.PARCEL-CACHE',
]);
const isExcludedDir = (name) => EXCLUDED_DIR_NAMES.has(name) || EXCLUDED_DIR_NAMES.has(name.toUpperCase());
const MAX_CAPS_FILE_BYTES = 1_048_576;
const MAX_CAPS_DEPTH = 5;
const MAX_CAPS_TOTAL_BYTES = 8 * 1_048_576;
const MAX_CAPS_FILES = 200;
const HOST_AGENTS_PROMPT_RE = /<dir-context>[\s\S]*?<\/dir-context>\n?/g;

function systemPromptHasInjection(systemPrompt) {
    if (typeof systemPrompt === 'string') {
        return systemPrompt.includes(CAPS_INJECTION_SYMBOL.description);
    }
    if (!Array.isArray(systemPrompt)) return false;
    return systemPrompt.some((item) => item && typeof item === 'object' && item[CAPS_INJECTION_SYMBOL] === true);
}

export function appendCapsContext(systemPrompt, rootDir) {
    if (systemPromptHasInjection(systemPrompt)) return systemPrompt;
    const context = buildCapsContext(rootDir);
    if (!context) return systemPrompt;
    return [{ [CAPS_INJECTION_SYMBOL]: true, text: context }, ...(Array.isArray(systemPrompt) ? systemPrompt : [systemPrompt])];
}

export function stripHostAgentsPrompt(systemPrompt) {
    if (typeof systemPrompt === 'string') {
        return systemPrompt.replaceAll(HOST_AGENTS_PROMPT_RE, '');
    }
    if (!Array.isArray(systemPrompt)) return systemPrompt;
    return systemPrompt.map((item) => typeof item === 'string' ? item.replaceAll(HOST_AGENTS_PROMPT_RE, '') : item);
}

export function buildCapsContext(rootDir) {
    const entries = [];
    const budget = { bytes: 0, files: 0 };
    let rootEntries;
    try {
        rootEntries = fs.readdirSync(rootDir, { withFileTypes: true });
    } catch {
        return '';
    }

    for (const entry of rootEntries) {
        if (budget.files >= MAX_CAPS_FILES || budget.bytes >= MAX_CAPS_TOTAL_BYTES) break;
        const fullPath = path.join(rootDir, entry.name);
        if (entry.isFile() && CAPS_FILE_RE.test(entry.name) && !EXCLUDED_FILE_NAMES.has(entry.name)) {
            const block = readCapsFile(fullPath, entry.name, budget);
            if (block) entries.push(block);
            continue;
        }
        if (entry.isDirectory() && CAPS_DIR_RE.test(entry.name) && !isExcludedDir(entry.name)) {
            collectCapsDir(rootDir, fullPath, entries, budget, 1);
        }
    }

    entries.sort((left, right) => left.filePath.localeCompare(right.filePath));
    return entries.map((entry) => entry.block).join('\n\n');
}

function collectCapsDir(rootDir, dirPath, entries, budget, depth) {
    if (depth > MAX_CAPS_DEPTH || budget.files >= MAX_CAPS_FILES || budget.bytes >= MAX_CAPS_TOTAL_BYTES) return;
    let children;
    try {
        children = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
        return;
    }
    for (const child of children) {
        if (budget.files >= MAX_CAPS_FILES || budget.bytes >= MAX_CAPS_TOTAL_BYTES) return;
        if (child.isDirectory()) {
            if (isExcludedDir(child.name) || child.name.startsWith('.')) continue;
            collectCapsDir(rootDir, path.join(dirPath, child.name), entries, budget, depth + 1);
            continue;
        }
        if (!child.isFile()) continue;
        const fullPath = path.join(dirPath, child.name);
        const block = readCapsFile(fullPath, path.relative(rootDir, fullPath), budget);
        if (block) entries.push(block);
    }
}

function readCapsFile(filePath, label, budget) {
    try {
        const stat = fs.statSync(filePath);
        if (!stat.isFile() || stat.size > MAX_CAPS_FILE_BYTES) return null;
        if (budget.bytes + stat.size > MAX_CAPS_TOTAL_BYTES) return null;
        const content = fs.readFileSync(filePath, 'utf-8');
        if (!content.trim()) return null;
        budget.bytes += stat.size;
        budget.files += 1;
        return {
            filePath,
            block: `<caps-context file="${escapeXml(label)}">\n${content}\n</caps-context>`,
        };
    } catch {
        return null;
    }
}

function escapeXml(value) {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&apos;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');
}
