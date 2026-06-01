import path from 'node:path';
import {
  buildQuery,
  consumeIterator,
  createExternalFinder,
  fileAnnotation,
  FinderManager,
  formatFindOutput,
  formatGrepOutput,
  resolveExternalBasePath,
  storeIterator,
  truncateLine,
} from 'engine/fuzzy';
import { clearIterators } from 'engine/util';

const FUZZY_FIND_DESCRIPTION = `Search for files by fuzzy path text matching. Returns file paths ranked by relevance and frecency. Supports partial matches on file names and directory paths. Regex and glob syntax are not supported.

First call: provide pattern and optional path.
Later calls: provide only iterator.
Every result ends with iterator="..."; iteration is finished when it becomes iterator="".`;

const FUZZY_GREP_DESCRIPTION = `Search file contents using fuzzy-aware content search. Smart-case, git-aware, frecency-ranked. Supports automatic regex mode for regex-like patterns and automatic fuzzy fallback when no exact matches are found.

First call: provide pattern and optional filters.
Later calls: provide only iterator.
Every result ends with iterator="..."; iteration is finished when it becomes iterator="".`;

export function createFuzzyFindTool(pi) {
  return {
    name: 'fuzzy_find',
    label: 'Fuzzy Find',
    description: FUZZY_FIND_DESCRIPTION,
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
            externalBasePath: null,
          };
        }

        const finder = await FinderManager.get(ctx.cwd);
        const result = finder.fileSearch(searchState.query, {
          pageSize: searchState.pageSize,
          pageIndex: searchState.pageIndex,
        });
        if (!result?.ok) throw new Error(result?.error || 'fuzzy_find failed');

        const searchResult = result.value;
        if (!searchResult?.items?.length) {
          return { content: [{ type: 'text', text: 'No matching files found\n\n[iterator=""]' }] };
        }

        const lines = [formatFindOutput(searchResult).split('\n')[0], ''];
        for (const item of searchResult.items) {
          lines.push(`${item.relativePath}${fileAnnotation(item)}`);
        }

        const nextPageIndex = searchState.pageIndex + 1;
        const nextIterator = (searchResult.totalMatched ?? 0) > nextPageIndex * searchState.pageSize
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
    description: FUZZY_GREP_DESCRIPTION,
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
        let searchState = params.iterator ? storeCursor(params.iterator) || consumeCursor(params.iterator) : null;
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
            try { new RegExp(params.pattern); } catch { mode = 'plain'; }
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
          : await FinderManager.get(ctx.cwd);

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
          try { external.finder.destroy(); } catch {}
        }
      }
    },
  };
}

export function storeCursor(state) {
  return storeIterator('omp_c', state);
}

export function consumeCursor(id) {
  return consumeIterator(id);
}

export function storeFindCursor(state) {
  return storeIterator('omp_f', state);
}

export function consumeFindCursor(id) {
  return consumeIterator(id);
}

export function resetFuzzyState() {
  clearIterators();
}

export const _test = {
  buildQuery,
  consumeCursor,
  consumeFindCursor,
  createExternalFinder,
  createFuzzyFindTool,
  createFuzzyGrepTool,
  getFinder: FinderManager.get,
  normalizeExcludes: (exclude, cwd) => {
    const list = Array.isArray(exclude) ? exclude : [exclude];
    return list.flatMap((item) => String(item).split(/[,\s]+/).map((s) => s.trim()).filter(Boolean).map((p) => p.startsWith('!') ? p : `!${p}`));
  },
  resolveExternalBasePath,
  resetFuzzyState,
  storeCursor,
  storeFindCursor,
};
