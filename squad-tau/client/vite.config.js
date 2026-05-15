import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
    root: __dirname,
    plugins: [react()],
    resolve: {
        alias: {
            '@shared': resolve(__dirname, '../shared'),
        },
        dedupe: ['react', 'react-dom'],
    },
    server: { middlewareMode: true },
});
