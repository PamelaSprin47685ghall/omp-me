import path from 'node:path';

let finderModulePromise;
const finderCache = new Map();
const grepCursorCache = new Map();
let grepCursorCounter = 0;
const findCursorCache = new Map();
let findCursorCounter = 0;

function storeCursor(state) {
    const id = `fff_c${++grepCursorCounter}`;
    grepCursorCache.set(id, state);
    if (grepCursorCache.size > 200) {
        const first = grepCursorCache.keys().next().value;
        if (first) grepCursorCache.delete(first);
    }
    return id;
}

function consumeCursor(id) {
    const state = grepCursorCache.get(id);
    if (state !== undefined) grepCursorCache.delete(id);
    return state;
}

function storeFindCursor(state) {
    const id = `fff_f${++findCursorCounter}`;
    findCursorCache.set(id, state);
    if (findCursorCache.size > 200) {
        const first = findCursorCache.keys().next().value;
        if (first) findCursorCache.delete(first);
    }
    return id;
}

function consumeFindCursor(id) {
    const state = findCursorCache.get(id);
    if (state !== undefined) findCursorCache.delete(id);
    return state;
}

function getFinderModule() {
    finderModulePromise ||= import('@ff-labs/fff-node');
    return finderModulePromise;
}

async function getFinder(cwd) {
    const cached = finderCache.get(cwd);
    if (cached && !cached.isDestroyed) return cached;
    const { FileFinder } = await getFinderModule();
    const created = FileFinder.create({ basePath: cwd, aiMode: true });
    if (!created.ok) throw new Error(created.error || 'Failed to create file finder');
    const finder = created.value;
    try {
        await finder.waitForScan(15000);
    } catch {}
    finderCache.set(cwd, finder);
    return finder;
}

function resolveExternalBasePath(absPath) {
    const normalized = path.resolve(absPath);
    const lastSegment = normalized.split(path.sep).pop() || '';
    if (lastSegment.startsWith('.') || /\.[a-zA-Z][a-zA-Z0-9]{0,9}$/.test(lastSegment)) {
        return {
            basePath: path.dirname(normalized),
            pathConstraint: lastSegment,
        };
    }
    return { basePath: normalized, pathConstraint: null };
}

async function createExternalFinder(basePath) {
    const { FileFinder } = await getFinderModule();
    const created = FileFinder.create({ basePath, aiMode: true });
    if (!created.ok) throw new Error(created.error || 'Failed to create file finder');
    const finder = created.value;
    try {
        await finder.waitForScan(15000);
    } catch {}
    return finder;
}

function normalizePathConstraint(pathConstraint, cwd) {
    let trimmed = pathConstraint?.trim();
    if (!trimmed) return null;
    if (path.isAbsolute(trimmed)) {
        const relative = path.relative(cwd, trimmed).replaceAll(path.sep, '/');
        if (!relative || relative.startsWith('../') || relative === '..') return null;
        trimmed = relative;
    }
    if (trimmed === '.' || trimmed === './') return null;
    if (trimmed.startsWith('./')) trimmed = trimmed.slice(2);
    const recursiveDir = /^(.*)\/\*\*(?:\/\*)?$/.exec(trimmed);
    if (recursiveDir?.[1] && !/[*?[{]/.test(recursiveDir[1])) return `${recursiveDir[1]}/`;
    if (trimmed.startsWith('/') || trimmed.endsWith('/')) return trimmed;
    if (/[*?[{]/.test(trimmed)) return trimmed;
    const lastSegment = trimmed.split('/').pop() || '';
    if (/\.[a-zA-Z][a-zA-Z0-9]{0,9}$/.test(lastSegment)) return trimmed;
    return `${trimmed}/`;
}

function normalizeExcludes(exclude, cwd) {
    if (!exclude) return [];
    const list = Array.isArray(exclude) ? exclude : [exclude];
    const output = [];
    for (const item of list) {
        for (const part of item.split(/[,\s]+/).map((value) => value.trim()).filter(Boolean)) {
            const stripped = part.startsWith('!') ? part.slice(1) : part;
            const normalized = normalizePathConstraint(stripped, cwd);
            if (normalized) output.push(`!${normalized}`);
        }
    }
    return output;
}

function buildQuery(pathConstraint, pattern, exclude, cwd, allowExternal = false) {
    const parts = [];
    if (pathConstraint) {
        if (allowExternal && path.isAbsolute(pathConstraint)) {
            parts.push(pathConstraint);
        } else {
            const normalizedPath = normalizePathConstraint(pathConstraint, cwd);
            if (normalizedPath) parts.push(normalizedPath);
        }
    }
    parts.push(...normalizeExcludes(exclude, cwd));
    parts.push(pattern);
    return parts.join(' ');
}

function fileAnnotation(item) {
    const gitStatus = item?.gitStatus;
    if (gitStatus && gitStatus !== 'clean' && gitStatus !== 'unknown') return `  [${gitStatus} in git]`;
    const frecency = item?.totalFrecencyScore ?? item?.accessFrecencyScore ?? 0;
    if (frecency >= 25) return '  [VERY often touched file]';
    if (frecency >= 20) return '  [often touched file]';
    return '';
}

function truncateLine(line) {
    const trimmed = line.trim();
    return trimmed.length <= 500 ? trimmed : `${trimmed.slice(0, 500)}...`;
}

function formatGrepOutput(result) {
    if (!result?.items?.length) return 'No matches found';
    const totalMatched = result.totalMatched ?? result.items.length;
    const lines = [`${totalMatched} match${totalMatched === 1 ? '' : 'es'}`, ''];
    let currentFile = '';
    for (const match of result.items) {
        if (!match) continue;
        if (match.relativePath !== currentFile) {
            if (currentFile) lines.push('');
            currentFile = match.relativePath;
            lines.push(`${currentFile}${fileAnnotation(match)}`);
        }
        for (let index = 0; index < (match.contextBefore?.length || 0); index += 1) {
            const lineNumber = match.lineNumber - match.contextBefore.length + index;
            lines.push(` ${lineNumber}- ${truncateLine(match.contextBefore[index])}`);
        }
        lines.push(` ${match.lineNumber}: ${truncateLine(match.lineContent)}`);
        for (let index = 0; index < (match.contextAfter?.length || 0); index += 1) {
            lines.push(` ${match.lineNumber + 1 + index}- ${truncateLine(match.contextAfter[index])}`);
        }
    }
    return lines.join('\n');
}

function formatFindHeader(result) {
    return `${result.totalMatched} matching file${result.totalMatched === 1 ? '' : 's'} (${result.totalFiles} total indexed)`;
}

export function createFuzzyFindTool(pi) {
    return {
        name: 'fuzzy_find',
        label: 'Fuzzy Find',
        description: 'Search for files by fuzzy path text matching. Returns file paths ranked by relevance and frecency. Supports partial matches on file names and directory paths. Regex and glob syntax are not supported.\n\nFirst call: provide pattern and optional path.\nLater calls: provide only iterator.\nEvery result ends with iterator="..."; iteration is finished when it becomes iterator="".',
        parameters: pi.typebox.Object({
            pattern: pi.typebox.Optional(pi.typebox.String({ description: "Initial plain fuzzy file path text to search for (e.g., 'component', 'src/utils/', 'Button.tsx'). Regex and glob syntax are not supported." })),
            path: pi.typebox.Optional(pi.typebox.String({ description: 'Initial optional path constraint to narrow search scope' })),
            limit: pi.typebox.Optional(pi.typebox.Number({ description: 'Maximum number of results to return per call (default: 30)' })),
            iterator: pi.typebox.Optional(pi.typebox.String({ description: 'Opaque single-use iterator from a previous fuzzy_find result. On continuation, pass only this field. Iteration is finished when the result shows iterator="".' })),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
            try {
                let searchState = params.iterator ? consumeFindCursor(params.iterator) : null;
                if (!searchState) {
                    if (params.iterator) {
                        return { content: [{ type: 'text', text: `fuzzy_find iterator error: unknown, expired, or already consumed iterator "${params.iterator}"` }], isError: true };
                    }
                    if (!params.pattern) {
                        return { content: [{ type: 'text', text: 'pattern is required on the first call' }], isError: true };
                    }
                    searchState = {
                        query: buildQuery(params.path, params.pattern, undefined, ctx.cwd),
                        pageSize: params.limit ?? 30,
                        pageIndex: 0,
                    };
                }

                const finder = await getFinder(ctx.cwd);
                const result = finder.fileSearch(searchState.query, {
                    pageSize: searchState.pageSize,
                    pageIndex: searchState.pageIndex,
                });
                if (!result?.ok) throw new Error(result?.error || 'fuzzy_find failed');

                const searchResult = result.value;
                if (!searchResult?.items?.length) {
                    return { content: [{ type: 'text', text: 'No matching files found\n\n[iterator=""]' }] };
                }

                const lines = [formatFindHeader(searchResult), ''];
                for (const item of searchResult.items) {
                    lines.push(`${item.relativePath}${fileAnnotation(item)}`);
                }

                const nextPageIndex = searchState.pageIndex + 1;
                const nextIterator = searchResult.totalMatched > nextPageIndex * searchState.pageSize
                    ? storeFindCursor({ ...searchState, pageIndex: nextPageIndex })
                    : '';
                return { content: [{ type: 'text', text: `${lines.join('\n')}\n\n[iterator="${nextIterator}"]` }] };
            } catch (error) {
                return { content: [{ type: 'text', text: `fuzzy_find error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
            }
        },
    };
}

export function createFuzzyGrepTool(pi) {
    return {
        name: 'fuzzy_grep',
        label: 'Fuzzy Grep',
        description: 'Search file contents using fuzzy-aware content search. Smart-case, git-aware, frecency-ranked. Supports automatic regex mode for regex-like patterns and automatic fuzzy fallback when no exact matches are found.\n\nFirst call: provide pattern and optional filters.\nLater calls: provide only iterator.\nEvery result ends with iterator="..."; iteration is finished when it becomes iterator="".',
        parameters: pi.typebox.Object({
            pattern: pi.typebox.Optional(pi.typebox.String({ description: 'Initial search pattern. Required on the first call. Supports literal text and regex-like patterns.' })),
            path: pi.typebox.Optional(pi.typebox.String({ description: "Initial path constraint (repo-relative or absolute path outside workspace). Use 'src/' or '*.ts' to narrow the first call." })),
            exclude: pi.typebox.Optional(pi.typebox.Union([
                pi.typebox.String({ description: "Initial exclude paths (e.g. 'test/,*.min.js')" }),
                pi.typebox.Array(pi.typebox.String({ description: 'Initial exclude path or glob' })),
            ])),
            caseSensitive: pi.typebox.Optional(pi.typebox.Boolean({ description: 'Initial case-sensitivity override (smart-case by default - case-insensitive when pattern is all lowercase)' })),
            context: pi.typebox.Optional(pi.typebox.Number({ description: 'Initial number of context lines before and after each match' })),
            limit: pi.typebox.Optional(pi.typebox.Number({ description: 'Maximum number of matches to return per call.' })),
            iterator: pi.typebox.Optional(pi.typebox.String({ description: 'Opaque single-use iterator from a previous fuzzy_grep result. On continuation, pass only this field. Iteration is finished when the result shows iterator="".' })),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
            const external = { finder: null };
            try {
                let searchState = params.iterator ? consumeCursor(params.iterator) : null;
                if (!searchState) {
                    if (params.iterator) {
                        return { content: [{ type: 'text', text: `fuzzy_grep iterator error: unknown, expired, or already consumed iterator "${params.iterator}"` }], isError: true };
                    }
                    if (!params.pattern) {
                        return { content: [{ type: 'text', text: 'pattern is required on the first call' }], isError: true };
                    }

                    let externalBasePath = null;
                    let externalPathConstraint = null;
                    if (params.path && path.isAbsolute(params.path)) {
                        const info = resolveExternalBasePath(path.resolve(params.path));
                        externalBasePath = info.basePath;
                        externalPathConstraint = info.pathConstraint;
                    }

                    const query = buildQuery(
                        externalBasePath ? externalPathConstraint : params.path,
                        params.pattern,
                        params.exclude,
                        externalBasePath ?? ctx.cwd,
                        !!externalBasePath,
                    );
                    const hasRegexSyntax = params.pattern !== params.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    let mode = hasRegexSyntax ? 'regex' : 'plain';
                    if (mode === 'regex') {
                        try {
                            new RegExp(params.pattern);
                        } catch {
                            mode = 'plain';
                        }
                    }
                    const trimmed = params.pattern.trim();
                    const wildcardOnly = hasRegexSyntax && /^(?:[.^$]*(?:[.][*+?]|\*|\+)[.^$]*|[.^$\s]*|\.\*\??|\.\*[+?]?|\.\+\??|\.|\*|\?)$/.test(trimmed);
                    if (wildcardOnly) {
                        return { content: [{ type: 'text', text: `Pattern '${params.pattern}' matches everything - fuzzy_grep needs a concrete substring or identifier.` }], isError: true };
                    }

                    searchState = {
                        query,
                        mode,
                        smartCase: params.caseSensitive !== true,
                        beforeContext: params.context ?? 0,
                        afterContext: params.context ?? 0,
                        pageSize: params.limit ?? 9999,
                        externalBasePath,
                        cursor: null,
                    };
                }

                const finder = searchState.externalBasePath
                    ? await (async () => {
                        const createdFinder = await createExternalFinder(searchState.externalBasePath);
                        external.finder = createdFinder;
                        return createdFinder;
                    })()
                    : await getFinder(ctx.cwd);

                const query = searchState.query;
                let result = finder.grep(searchState.query, {
                    mode: searchState.mode,
                    smartCase: searchState.smartCase,
                    maxMatchesPerFile: Math.min(searchState.pageSize, 50),
                    pageSize: searchState.pageSize,
                    cursor: searchState.cursor,
                    beforeContext: searchState.beforeContext,
                    afterContext: searchState.afterContext,
                    classifyDefinitions: true,
                });
                if (!result?.ok) throw new Error(result?.error || 'fuzzy_grep failed');

                let value = result.value;
                let fuzzyNotice = null;
                if (!value?.items?.length && !params.iterator && searchState.mode !== 'regex') {
                    const fuzzy = finder.grep(query, {
                        mode: 'fuzzy',
                        smartCase: searchState.smartCase,
                        maxMatchesPerFile: Math.min(searchState.pageSize, 50),
                        pageSize: searchState.pageSize,
                        cursor: null,
                        beforeContext: 0,
                        afterContext: 0,
                        classifyDefinitions: true,
                    });
                    if (fuzzy?.ok && fuzzy.value?.items?.length) {
                        value = fuzzy.value;
                        fuzzyNotice = '0 exact matches. Maybe you meant this?';
                    }
                }

                let output = formatGrepOutput(value);
                const notices = [];
                if (value?.regexFallbackError) notices.push(`Invalid regex: ${value.regexFallbackError}, used literal match`);
                notices.push(`iterator="${value?.nextCursor ? storeCursor({ ...searchState, cursor: value.nextCursor }) : ''}"`);
                if (notices.length) output += `\n\n[${notices.join('. ')}]`;
                if (fuzzyNotice) output = `[${fuzzyNotice}]\n${output}`;
                return { content: [{ type: 'text', text: output }] };
            } catch (error) {
                return { content: [{ type: 'text', text: `fuzzy_grep error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
            } finally {
                if (external.finder) {
                    try {
                        external.finder.destroy();
                    } catch {}
                }
            }
        },
    };
}

export function resetFuzzyState() {
    grepCursorCache.clear();
    grepCursorCounter = 0;
    findCursorCache.clear();
    findCursorCounter = 0;
    finderCache.clear();
    finderModulePromise = undefined;
}

export const _test = {
    buildQuery,
    consumeCursor,
    consumeFindCursor,
    createExternalFinder,
    createFuzzyFindTool,
    createFuzzyGrepTool,
    getFinder,
    normalizeExcludes,
    normalizePathConstraint,
    resolveExternalBasePath,
    resetFuzzyState,
    storeFindCursor,
    storeCursor,
};
