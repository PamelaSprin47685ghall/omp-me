#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const out = fs.createWriteStream('audit.txt');
const exts = ['.js', '.jsx', '.md', '.html', '.css', '.json', '.toml'];
const skip = new Set(['node_modules', '.git', 'audit.txt', 'bun.lock', 'audit.sh']);

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.relative('.', full);
    if (entry.isDirectory()) {
      if (!skip.has(entry.name)) walk(full);
    } else if (entry.isFile()) {
      if (skip.has(entry.name)) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (exts.includes(ext) || entry.name === 'README' || entry.name.startsWith('SPEC')) {
        out.write('\n========== ' + rel + ' ==========\n\n');
        out.write(fs.readFileSync(full, 'utf-8'));
        out.write('\n');
      }
    }
  }
}

walk('.');
out.end();
