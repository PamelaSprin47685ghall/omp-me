#!/usr/bin/env node

/**
 * oh-taskplane — proxy to the taskplane CLI from the npm dependency.
 *
 * Usage:
 *   npx oh-taskplane init
 *   npx oh-taskplane doctor
 *   npx oh-taskplane dashboard
 */

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const taskplaneBin = join(__dirname, "..", "node_modules", "taskplane", "bin", "taskplane.mjs");

const child = spawn(process.execPath, [taskplaneBin, ...process.argv.slice(2)], {
	stdio: "inherit",
});

child.on("exit", (code) => process.exit(code ?? 1));
