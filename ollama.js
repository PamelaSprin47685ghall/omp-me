import { lookup } from 'node:dns/promises';
import net from 'node:net';

const OLLAMA_API_BASE = 'https://ollama.com/api';

export const OLLAMA_TOOL_NAMES = ['websearch', 'webfetch'];

export function getOllamaKey() {
    return process.env.OLLAMA_API_KEY || '';
}

const LOOPBACK_HOSTNAMES = new Set(['localhost', 'ip6-localhost', 'ip6-loopback']);

function isPrivateIPv4(ip) {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return true;
    if (parts[0] === 10) return true;
    if (parts[0] === 127) return true;
    if (parts[0] === 0) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;
    if (parts[0] >= 224) return true;
    return false;
}

function isPrivateIPv6(ip) {
    const normalized = ip.toLowerCase();
    if (normalized === '::' || normalized === '::1' || normalized === '0:0:0:0:0:0:0:1' || normalized === '0:0:0:0:0:0:0:0') return true;
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
    if (normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) return true;
    if (normalized.startsWith('::ffff:')) {
        const mapped = normalized.slice(7);
        return isPrivateIPv4(mapped);
    }
    return false;
}

function ipIsBlocked(ip) {
    const family = net.isIP(ip);
    if (family === 4) return isPrivateIPv4(ip);
    if (family === 6) return isPrivateIPv6(ip);
    return true;
}

function validateHostname(hostname) {
    const stripped = hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (LOOPBACK_HOSTNAMES.has(stripped)) return 'localhost fetch is not allowed';
    if (net.isIP(stripped)) return ipIsBlocked(stripped) ? 'private network fetch is not allowed' : null;
    return null;
}

async function resolveAndValidate(hostname) {
    const staticError = validateHostname(hostname);
    if (staticError) return staticError;
    let addresses;
    try {
        addresses = await lookup(hostname, { all: true, verbatim: true });
    } catch {
        return 'hostname could not be resolved';
    }
    if (!addresses.length) return 'hostname resolved to no addresses';
    for (const { address } of addresses) {
        if (ipIsBlocked(address)) return 'private network fetch is not allowed';
    }
    return null;
}

async function validateFetchUrl(url) {
    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        return 'invalid URL';
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return `unsupported URL scheme: ${parsed.protocol}`;
    }
    return await resolveAndValidate(parsed.hostname);
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
                const urlError = await validateFetchUrl(params.url);
                if (urlError) return asErrorResult(new Error(urlError));
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
