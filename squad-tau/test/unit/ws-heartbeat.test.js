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

        // startHeartbeat now creates two intervals (pingTimer + timeoutTimer).
        // We collect both callbacks and trigger the ping timer.
        const originalSetInterval = global.setInterval;
        const intervalCbs = [];
        global.setInterval = (cb) => {
            intervalCbs.push(cb);
            return 123;
        };

        const stop = startHeartbeat(clients);

        expect(intervalCbs.length).toBe(2);
        const pingCb = intervalCbs[0]; // first interval is the ping timer
        pingCb(); // Trigger heartbeat check

        expect(mockWs1.isAlive).toBe(false);
        expect(mockWs1.ping).toHaveBeenCalled();
        expect(mockWs1.terminate).not.toHaveBeenCalled();

        expect(mockWs2.terminate).toHaveBeenCalled();
        expect(mockWs3.terminate).toHaveBeenCalled();

        global.setInterval = originalSetInterval;
        stop();
    });
});
