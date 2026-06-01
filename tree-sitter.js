import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const FILE_EDIT_TOOLS = new Set(['edit', 'write', 'Write', 'ast_edit', 'ast_grep_replace']);
const SYNTAX_MARKER = '[syntax-check]';
let wasmPackPromise = null;

function loadWasmPack() {
    if (wasmPackPromise) return wasmPackPromise;

    const require = createRequire(import.meta.url);
    const Module = require('node:module');
    const originalRequire = Module.prototype.require;
    const memoryHolder = { buffer: new ArrayBuffer(0) };
    const getMemoryView = () => new Uint8Array(memoryHolder.buffer);

    const envMock = {
        strcmp: (leftPointer, rightPointer) => {
            const memory = getMemoryView();
            let index = 0;
            while (true) {
                const leftChar = memory[leftPointer + index];
                const rightChar = memory[rightPointer + index];
                if (leftChar !== rightChar) return leftChar - rightChar;
                if (leftChar === 0) return 0;
                index += 1;
            }
        },
        memchr: (pointer, character, count) => {
            const memory = getMemoryView();
            const target = character & 0xff;
            for (let index = 0; index < count; index += 1) {
                if (memory[pointer + index] === target) return pointer + index;
            }
            return 0;
        },
        iswlower: (codePoint) => {
            try {
                const character = String.fromCodePoint(codePoint);
                return character === character.toLowerCase() && character !== character.toUpperCase() ? 1 : 0;
            } catch {
                return 0;
            }
        },
        iswupper: (codePoint) => {
            try {
                const character = String.fromCodePoint(codePoint);
                return character === character.toUpperCase() && character !== character.toLowerCase() ? 1 : 0;
            } catch {
                return 0;
            }
        },
        iswxdigit: (codePoint) => (codePoint >= 48 && codePoint <= 57) || (codePoint >= 97 && codePoint <= 102) || (codePoint >= 65 && codePoint <= 70) ? 1 : 0,
        towlower: (codePoint) => {
            try {
                const character = String.fromCodePoint(codePoint);
                return character.toLowerCase().codePointAt(0) || codePoint;
            } catch {
                return codePoint;
            }
        },
    };

    Module.prototype.require = function patchedRequire(id) {
        if (id === 'env') return envMock;
        return originalRequire.apply(this, arguments);
    };

    const OriginalInstance = WebAssembly.Instance;
    WebAssembly.Instance = function patchedInstance(module, importObject) {
        const instance = new OriginalInstance(module, importObject);
        if (instance.exports?.memory) {
            memoryHolder.buffer = instance.exports.memory.buffer;
        }
        return instance;
    };

    wasmPackPromise = (async () => {
        try {
            return await import('@kreuzberg/tree-sitter-language-pack-wasm');
        } finally {
            Module.prototype.require = originalRequire;
            WebAssembly.Instance = OriginalInstance;
        }
    })();

    return wasmPackPromise;
}

async function ensureWasmPack() {
    return loadWasmPack();
}

function findErrors(node) {
    const errors = [];
    if (node.isError() || node.isMissing()) errors.push(node);
    for (let index = 0; index < node.childCount(); index += 1) {
        const child = node.child(index);
        if (child) errors.push(...findErrors(child));
    }
    return errors;
}

export async function checkSyntax(content, filePath) {
    try {
        const pack = await ensureWasmPack();
        const language = pack.detectLanguageFromPath(filePath);
        if (!language) return { ok: false, reason: `unsupported language: ${filePath}` };

        const parser = pack.WasmParser.default();
        parser.setLanguage(language);

        const tree = parser.parse(content);
        if (!tree) return { ok: false, reason: 'failed to parse tree content' };

        const errors = findErrors(tree.rootNode()).map((node) => {
            const start = node.startPosition();
            const end = node.endPosition();
            return {
                line: start.row + 1,
                column: start.column + 1,
                endLine: end.row + 1,
                endColumn: end.column + 1,
                severity: 'error',
                message: node.isMissing() ? `Missing: ${node.kind()}` : 'Syntax error',
            };
        });

        return { ok: true, lang: language, errors };
    } catch (error) {
        return { ok: false, reason: `parse error: ${error instanceof Error ? error.message : String(error)}` };
    }
}

function extractInputPath(input) {
    const candidate = input?.path || input?.file_path || input?.filePath;
    return typeof candidate === 'string' && candidate ? candidate : null;
}

export async function appendSyntaxDiagnostics(rootDir, event) {
    if (!FILE_EDIT_TOOLS.has(event.toolName)) return undefined;
    const filePath = extractInputPath(event.input);
    if (!filePath) return undefined;

    const resolvedPath = path.resolve(rootDir, filePath);
    let content;
    try {
        content = await fs.readFile(resolvedPath, 'utf-8');
    } catch {
        return undefined;
    }

    const result = await checkSyntax(content, filePath);
    if (!result.ok || result.errors.length === 0) return undefined;
    if (!Array.isArray(event.content)) return undefined;

    const textBlock = event.content.find((block) => block?.type === 'text' && typeof block.text === 'string');
    if (!textBlock || textBlock.text.includes(SYNTAX_MARKER)) return undefined;

    textBlock.text += [
        '',
        SYNTAX_MARKER,
        `${result.errors.length} syntax issue(s) in ${filePath} (${result.lang}):`,
        ...result.errors.map((item) => `  L${item.line}:${item.column}-${item.endLine}:${item.endColumn} [${item.severity}] ${item.message}`),
    ].join('\n');

    return { content: event.content };
}

export function supportsSyntaxDiagnosticsTool(toolName) {
    return FILE_EDIT_TOOLS.has(toolName);
}
