import { createServer } from 'http';
import { readFileSync } from 'fs';
import { join } from 'path';

export async function createHttpServer({ viteMiddlewares, server: existingServer, clientRoot } = {}) {
    const server = existingServer || createServer();

    server.on('request', (req, res) => {
        // Kill Vite HMR client — its WS spam blocks React mount in headless tests
        if (req.url === '/@vite/client') {
            res.writeHead(200, { 'Content-Type': 'application/javascript' });
            res.end(
                'export function createHotContext(){return{accept(){},dispose(){},on(){},invalidate(){},acceptExports(){},prune(){},decline(){},off(){}};}' +
                    'export function injectQuery(e){return e;}export function removeStyle(){}' +
                    'export function updateStyle(){}export default{};export function ErrorOverlay(){}' +
                    'export const __vite_hot={data:{}};',
            );
            return;
        }
        if (req.url === '/api/status') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok', port: server.address()?.port, uptime: process.uptime() }));
        } else if (viteMiddlewares) {
            viteMiddlewares(req, res, () => {
                if (req.method === 'GET' && !req.url.startsWith('/api/') && !req.url.includes('.') && clientRoot) {
                    try {
                        res.writeHead(200, { 'Content-Type': 'text/html' });
                        res.end(readFileSync(join(clientRoot, 'index.html'), 'utf8'));
                        return;
                    } catch {}
                }
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('Not Found');
            });
        } else {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not Found');
        }
    });

    const port = await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            server.removeListener('error', reject);
            resolve(server.address().port);
        });
    });

    return { server, port, close: () => new Promise((r) => server.close(() => r())) };
}
