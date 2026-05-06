# Ollama Search Spec

Version: `1.0.0`.

`README.md` covers usage. This file defines the API contract, error handling, and compatibility rules.

## Public surface

| Capability | Names |
|---|---|
| Tools | `ollama_search`, `ollama_fetch` |
| Commands | `/ollama-key` |

## API contract

### ollama_search

- **HTTP**: `POST https://ollama.com/api/web_search`
- **Auth**: `Authorization: Bearer <OLLAMA_API_KEY>`
- **Request body**: `{ "query": string, "max_results"?: number }`
- **Response body**: `{ "results": [{ "title": string, "url": string, "content": string }] }`
- **Tool output**: formatted markdown with numbered results (title, URL, content snippet)
- **Tool details**: raw `{ results }` array

### ollama_fetch

- **HTTP**: `POST https://ollama.com/api/web_fetch`
- **Auth**: `Authorization: Bearer <OLLAMA_API_KEY>`
- **Request body**: `{ "url": string }`
- **Response body**: `{ "title": string, "content": string, "links": string[] }`
- **Tool output**: formatted markdown with title, content, and up to 10 links
- **Tool details**: raw `{ title, content, links }`

## Error handling

| Scenario | Behavior |
|---|---|
| `OLLAMA_API_KEY` not set | Throws `OLLAMA_API_KEY is not set — use /ollama-key <key> to set it` |
| HTTP 4xx/5xx from Ollama API | Throws `Ollama web search/fetch API error (status NNN): <response body>` |
| Network error (fetch fails) | Propagates the native fetch error |
| `max_results` omitted | Defaults to 5 |
| No results returned | Returns `No results found.` |
| Empty links array | Displays `Links found: 0` |

## Parameter validation

- `ollama_search.query` (string, required)
- `ollama_search.max_results` (number, optional, default 5)
- `ollama_fetch.url` (string, required)

## Compatibility with built-in web_search

- Tool names are prefixed with `ollama_` to avoid conflicts
- Both can coexist — LLM can choose between them
- To disable built-in `web_search`: set `web_search.enabled: false` in Oh My Pi settings
- To make `ollama_search` the default: disable built-in and keep this extension enabled

## Full-suite compatibility

- Tool registration is idempotent (guarded by WeakSet).
- Command `/ollama-key` stores the API key in `~/.omp/agent/ollama.json`.
- Forked sessions and subagents inherit the extension through Oh My Pi's extension discovery.

## Dependencies

- `OLLAMA_API_KEY` environment variable (no npm dependencies, no local Ollama)

## Test

```bash
npm test
```
