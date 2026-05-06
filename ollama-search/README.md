# Ollama Search

Web search and fetch tools for Oh My Pi agents — uses Ollama's cloud APIs. **No local Ollama installation required.**

Version: `1.0.0`.

## What it provides

| Capability | Name |
|---|---|
| Tool | `ollama_search` — search the web using Ollama's cloud API |
| Tool | `ollama_fetch` — fetch and extract text content from a web page |
| Commands | `/ollama-key` — set your Ollama API key |

## How it works

Both tools call Ollama's cloud APIs at `https://ollama.com/api/`:

- **`ollama_search`**: sends a query + optional `max_results`, returns ranked results with title, URL, and content snippet.
- **`ollama_fetch`**: sends a URL, returns the page title, extracted content, and links.

Authentication is via `OLLAMA_API_KEY` environment variable. Set it in `.env` or use the `/ollama-key` command.

## Installation

Place the `ollama-search` directory in one of these locations:

1. **Project-level**: `<project-root>/extensions/ollama-search/`
2. **User-level**: `~/.omp/extensions/ollama-search/`
3. **Via settings**: Add extension path in Oh My Pi settings

```bash
# Project-level (recommended)
mkdir -p extensions
cp -r ollama-search extensions/

# Or user-level
mkdir -p ~/.omp/extensions
cp -r ollama-search ~/.omp/extensions/
```

## Setup

```bash
# Set your Ollama API key
echo "OLLAMA_API_KEY=ollama-..." >> .env
```

Or use the `/ollama-key` command in Oh My Pi:

```
/ollama-key ollama-your-api-key-here
```

## Usage

The LLM can use these tools when it needs web information:

- `ollama_search` — alternative to the built-in `web_search` tool, powered by Ollama
- `ollama_fetch` — fetch full content from a specific URL

**Note:** These tools are prefixed with `ollama_` to avoid conflicts with Oh My Pi's built-in `web_search` tool. You can use both side-by-side, or disable the built-in one if you prefer Ollama.

## Choosing between built-in web_search and ollama_search

Oh My Pi has a built-in `web_search` tool that supports multiple providers (Anthropic, Perplexity, Brave, Kagi, etc.). This extension adds Ollama as an alternative option.

**Use `ollama_search` if:**
- You have an Ollama API key
- You prefer Ollama's search results
- You want a simple, dedicated search tool

**Use built-in `web_search` if:**
- You want to choose from multiple providers
- You need advanced features like recency filters
- You're already using other providers

You can have both enabled and let the LLM choose, or disable one via settings.

## Operational notes

- The cloud API requires an [Ollama account](https://ollama.com) and API key.
- No `ollama serve` process needed — everything goes through `https://ollama.com/api/`.
- Tool names are `ollama_search` and `ollama_fetch` (prefixed to avoid conflict with built-in tools).
- Forked sessions and subagents inherit the extension automatically.
- API errors surface the HTTP status and response body for debugging.

## Maintainer spec

See [`SPEC.md`](./SPEC.md) for API contract, error handling, and compatibility rules.

## Test

```bash
npm test
```
