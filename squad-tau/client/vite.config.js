import { defineConfig } from 'vite';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
    root: __dirname,
    resolve: {
        alias: {
            '@shared': resolve(__dirname, '../shared'),
        },
    },
    server: { middlewareMode: true },
});
