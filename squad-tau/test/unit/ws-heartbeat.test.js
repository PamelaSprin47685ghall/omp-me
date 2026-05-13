import { describe, test, expect, it, mock } from 'bun:test';
import { startHeartbeat } from '../../server/ws-heartbeat.js';

describe('ws-heartbeat', () => {
    test('pings alive, terminates non-OPEN and already-dead clients', () => {
        const mockWs1 = {
            readyState: 1, // OPEN
            terminate: mock(() => {}),
            ping: mock(() => {}),
        };
        const mockWs2 = {
            readyState: 0, // CONNECTING
            terminate: mock(() => {}),
        };
        const mockWs3 = {
            readyState: 1,
            _missedPongs: 2, // already exceeds threshold
            terminate: mock(() => {}),
            ping: mock(() => {}),
        };

        const clients = new Set([mockWs1, mockWs2, mockWs3]);

        const originalSetInterval = global.setInterval;
        const intervalCbs = [];
        global.setInterval = (cb) => {
            intervalCbs.push(cb);
            return 123;
        };

        const stop = startHeartbeat(clients);

        expect(intervalCbs.length).toBe(1);
        intervalCbs[0]();

        // ws1: OPEN, not dead → ping
        expect(mockWs1.ping).toHaveBeenCalled();
        expect(mockWs1.terminate).not.toHaveBeenCalled();

        // ws2: non-OPEN → terminate
        expect(mockWs2.terminate).toHaveBeenCalled();

        // ws3: already dead (_missedPongs >= 2) → terminate
        expect(mockWs3.terminate).toHaveBeenCalled();

        global.setInterval = originalSetInterval;
        stop();
    });

    test('terminates after two consecutive missed pong', () => {
        const mockWs = {
            readyState: 1,
            terminate: mock(() => {}),
            ping: mock(() => {}),
        };
        const clients = new Set([mockWs]);

        const originalSetInterval = global.setInterval;
        const intervalCbs = [];
        global.setInterval = (cb) => {
            intervalCbs.push(cb);
            return 123;
        };

        const stop = startHeartbeat(clients);

        intervalCbs[0](); // Tick 1: _missedPongs → 1, ping
        expect(mockWs.ping).toHaveBeenCalled();
        expect(mockWs.terminate).not.toHaveBeenCalled();
        expect(mockWs._missedPongs).toBe(1);

        intervalCbs[0](); // Tick 2: _missedPongs → 2, terminate
        expect(mockWs.terminate).toHaveBeenCalled();

        global.setInterval = originalSetInterval;
        stop();
    });
});
