import { describe, test, expect, it, mock } from 'bun:test';
import { startHeartbeat } from '../../server/ws-heartbeat.js';

describe('ws-heartbeat', () => {
    test('terminates inactive or dead clients', () => {
        const mockWs1 = {
            readyState: 1, // OPEN
            isAlive: true,
            terminate: mock(() => {}),
            ping: mock(() => {}),
        };
        const mockWs2 = {
            readyState: 0, // CONNECTING
            terminate: mock(() => {}),
        };
        const mockWs3 = {
            readyState: 1,
            isAlive: false,
            terminate: mock(() => {}),
        };

        const clients = new Set([mockWs1, mockWs2, mockWs3]);

        // Mock setInterval to trigger immediately or control time
        // But since we can't easily mock global setInterval in bun without more effort,
        // we can test the logic if we export the inner function,
        // but it's not exported.
        // Let's mock global.setInterval
        const originalSetInterval = global.setInterval;
        let intervalCb;
        global.setInterval = (cb) => {
            intervalCb = cb;
            return 123;
        };

        const stop = startHeartbeat(clients);

        expect(intervalCb).toBeDefined();
        intervalCb(); // Trigger heartbeat check

        expect(mockWs1.isAlive).toBe(false);
        expect(mockWs1.ping).toHaveBeenCalled();
        expect(mockWs1.terminate).not.toHaveBeenCalled();

        expect(mockWs2.terminate).toHaveBeenCalled();
        expect(mockWs3.terminate).toHaveBeenCalled();

        global.setInterval = originalSetInterval;
        stop();
    });
});
