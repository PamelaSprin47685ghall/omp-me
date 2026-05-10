import { stubPi } from '../helpers/mock-pi.js';
import { EventBus } from '../../server/event-bus.js';
import { ModelPool } from '../../server/model-pool.js';
import SquadFSM from '../../server/squad-fsm.js';
import * as sessionRegistry from '../../server/session-registry.js';

export function createTestEnvironment() {
    const pi = stubPi();
    const eventBus = new EventBus();
    const modelPool = new ModelPool([
        { provider: 'test', modelId: 'worker-1', role: 'worker', thinkingLevel: null },
        { provider: 'test', modelId: 'reviewer-1', role: 'reviewer', thinkingLevel: null },
    ]);
    const squadFsm = new SquadFSM();
    const controller = new AbortController();
    const signal = controller.signal;

    return {
        pi,
        eventBus,
        modelPool,
        squadFsm,
        sessionRegistry,
        signal,
    };
}
