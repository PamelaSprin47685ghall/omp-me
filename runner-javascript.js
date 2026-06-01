import fs from 'node:fs';
import path from 'node:path';
import { runChildProcess } from './runner-process.js';
import { ensureRunnerDir } from './runner-paths.js';

const PACKAGE_JSON = 'package.json';
const PACKAGE_LOCK = 'package-lock.json';
const NODE_MODULES = 'node_modules';

function hashDependencies(dependencies) {
    const sorted = [...(dependencies || [])].sort();
    return JSON.stringify(sorted);
}

function projectSignature(projectDir, dependencies) {
    const packageJsonPath = path.join(projectDir, PACKAGE_JSON);
    const packageLockPath = path.join(projectDir, PACKAGE_LOCK);
    const nodeModulesPath = path.join(projectDir, NODE_MODULES);

    try {
        if (!fs.existsSync(nodeModulesPath)) return null;
        const packageLockStat = fs.statSync(packageLockPath);
        const signaturePath = path.join(projectDir, '.kunwei-deps.sig');
        const expected = `${hashDependencies(dependencies)}|${packageLockStat.mtimeMs}`;
        if (fs.existsSync(signaturePath) && fs.readFileSync(signaturePath, 'utf-8') === expected) {
            return expected;
        }
    } catch {}
    return null;
}

function writeProjectSignature(projectDir, dependencies) {
    const packageJsonPath = path.join(projectDir, PACKAGE_JSON);
    const packageLockPath = path.join(projectDir, PACKAGE_LOCK);
    const signaturePath = path.join(projectDir, '.kunwei-deps.sig');
    const packageLockStat = fs.statSync(packageLockPath);
    const expected = `${hashDependencies(dependencies)}|${packageLockStat.mtimeMs}`;
    fs.writeFileSync(signaturePath, expected, 'utf-8');
}

export async function ensureJavascriptProject(projectDir, dependencies) {
    ensureRunnerDir();
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, PACKAGE_JSON), '{"type":"module"}\n', 'utf-8');

    const requiredPackages = [...new Set(['tsx', ...(dependencies || [])])];
    const cached = projectSignature(projectDir, dependencies);
    if (cached) return;

    await runChildProcess({
        command: 'npx',
        args: ['--yes', 'npm@latest', 'install', '--prefix', projectDir, ...requiredPackages],
        cwd: projectDir,
    });

    writeProjectSignature(projectDir, dependencies);
}
