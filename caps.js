import fs from 'node:fs';
import path from 'node:path';

const CAPS_FILE_RE = /^[A-Z][A-Z0-9_]*\.md$/;
const CAPS_DIR_RE = /^[A-Z][A-Z0-9_]*$/;
const EXCLUDED_FILE_NAMES = new Set(['CLAUDE.md', 'README.md']);
const EXCLUDED_DIR_NAMES = new Set(['CLAUDE', 'NODE_MODULES']);
const MAX_CAPS_FILE_BYTES = 1_048_576;
const HOST_AGENTS_PROMPT_RE = /<dir-context>[\s\S]*?<\/dir-context>\n?/g;

export function appendCapsContext(systemPrompt, rootDir) {
    if (systemPrompt.some((item) => typeof item === 'string' && item.includes('<caps-context'))) return systemPrompt;
    const context = buildCapsContext(rootDir);
    if (!context) return systemPrompt;
    return [context, ...systemPrompt];
}

export function stripHostAgentsPrompt(systemPrompt) {
    return systemPrompt.map((item) => typeof item === 'string' ? item.replaceAll(HOST_AGENTS_PROMPT_RE, '') : item);
}

export function buildCapsContext(rootDir) {
    const entries = [];
    let rootEntries;
    try {
        rootEntries = fs.readdirSync(rootDir, { withFileTypes: true });
    } catch {
        return '';
    }

    for (const entry of rootEntries) {
        const fullPath = path.join(rootDir, entry.name);
        if (entry.isFile() && CAPS_FILE_RE.test(entry.name) && !EXCLUDED_FILE_NAMES.has(entry.name)) {
            const block = readCapsFile(fullPath, entry.name);
            if (block) entries.push(block);
            continue;
        }
        if (entry.isDirectory() && CAPS_DIR_RE.test(entry.name) && !EXCLUDED_DIR_NAMES.has(entry.name)) {
            collectCapsDir(rootDir, fullPath, entries);
        }
    }

    entries.sort((left, right) => left.filePath.localeCompare(right.filePath));

    return entries.map((entry) => entry.block).join('\n\n');
}

function collectCapsDir(rootDir, dirPath, entries) {
    let children;
    try {
        children = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
        return;
    }
    for (const child of children) {
        const fullPath = path.join(dirPath, child.name);
        if (child.isDirectory()) {
            collectCapsDir(rootDir, fullPath, entries);
            continue;
        }
        const label = path.relative(rootDir, fullPath);
        const block = readCapsFile(fullPath, label);
        if (block) entries.push(block);
    }
}

function readCapsFile(filePath, label) {
    try {
        const stat = fs.statSync(filePath);
        if (!stat.isFile() || stat.size > MAX_CAPS_FILE_BYTES) return null;
        const content = fs.readFileSync(filePath, 'utf-8');
        if (!content.trim()) return null;
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
