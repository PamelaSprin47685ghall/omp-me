const OLLAMA_API_BASE = 'https://ollama.com/api';

export const OLLAMA_TOOL_NAMES = ['websearch', 'webfetch'];

export function getOllamaKey() {
    return process.env.OLLAMA_API_KEY || '';
}

async function ollamaPost(pathname, body, signal) {
    const response = await fetch(`${OLLAMA_API_BASE}${pathname}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${getOllamaKey()}`,
        },
        body: JSON.stringify(body),
        signal,
    });
    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Ollama API error (${response.status}): ${text || response.statusText}`);
    }
    return await response.json();
}

function buildSearchText(results) {
    if (!results?.length) return 'No results found.';
    return results.map((item, index) => `${index + 1}. ${item.title}\n   URL: ${item.url}\n   ${item.content}`).join('\n\n');
}

export function registerOllamaTools(pi, helpers) {
    const { asErrorResult } = helpers;

    pi.registerTool({
        name: 'websearch',
        label: 'Ollama Search',
        description: 'Search the web using Ollama web search.',
        parameters: pi.typebox.Object({
            query: pi.typebox.String({ description: 'Natural language search query.' }),
            numResults: pi.typebox.Optional(pi.typebox.Number({ description: 'Maximum results to return.' })),
        }),
        async execute(_toolCallId, params, signal) {
            try {
                const data = await ollamaPost('/web_search', { query: params.query, max_results: params.numResults ?? 10 }, signal);
                return { content: [{ type: 'text', text: buildSearchText(data.results || []) }], details: data };
            } catch (error) {
                return asErrorResult(error);
            }
        },
    });

    pi.registerTool({
        name: 'webfetch',
        label: 'Ollama Fetch',
        description: 'Fetch URL content using Ollama web fetch.',
        parameters: pi.typebox.Object({
            url: pi.typebox.String({ description: 'URL to fetch.' }),
            extract_main: pi.typebox.Optional(pi.typebox.Boolean({ description: 'Whether to extract main content.' })),
            prefer_llms_txt: pi.typebox.Optional(pi.typebox.String({ description: 'auto, always, or never.' })),
            prompt: pi.typebox.Optional(pi.typebox.String({ description: 'Optional extraction task.' })),
            timeout: pi.typebox.Optional(pi.typebox.Number({ description: 'Timeout in seconds.' })),
        }),
        async execute(_toolCallId, params, signal) {
            try {
                const data = await ollamaPost('/web_fetch', {
                    url: params.url,
                    extract_main: params.extract_main ?? true,
                    prefer_llms_txt: params.prefer_llms_txt ?? 'auto',
                    prompt: params.prompt,
                    timeout: params.timeout,
                }, signal);
                const text = [
                    `Title: ${data.title || ''}`,
                    data.byline ? `By: ${data.byline}` : null,
                    typeof data.length === 'number' ? `Length: ${data.length}` : null,
                    '',
                    data.content || '',
                ].filter(Boolean).join('\n');
                return { content: [{ type: 'text', text }], details: data };
            } catch (error) {
                return asErrorResult(error);
            }
        },
    });
}
