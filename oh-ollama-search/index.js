/**
 * oh-ollama-search — oh-my-pi extension adaptor for @ollama/pi-web-search
 *
 * Wraps @ollama/pi-web-search (https://www.npmjs.com/package/@ollama/pi-web-search)
 * as an oh-my-pi extension. The original package registers two tools
 * (web_search, web_fetch) that call the local Ollama instance's experimental
 * API at http://localhost:11434.
 *
 * The extension only uses `import type { ExtensionAPI }` (erased at runtime)
 * and imports `Type` directly from `@sinclair/typebox`. No shim packages
 * are needed.
 */

import { join } from "node:path";
import { fileURLToPath } from "node:url";

export default async function ohOllamaSearchAdaptor(pi) {
	const __dirname = fileURLToPath(new URL(".", import.meta.url));
	const extPath = join(__dirname, "node_modules", "@ollama", "pi-web-search", "index.ts");

	const { default: ollamaSearchExtension } = await import("file://" + extPath);

	const bridge = createBridge(pi);
	ollamaSearchExtension(bridge);
}

export function createBridge(pi) {
	return {
		registerTool(toolDef) {
			pi.registerTool(toolDef);
		},
	};
}
