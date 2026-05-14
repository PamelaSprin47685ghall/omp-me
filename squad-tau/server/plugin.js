/**
 * Squad-Tau Plugin Entry (Event-Sourced Architecture).
 *
 * Registers the delegate tool and starts the HTTP/WS server.
 * Uses the new processDelegate entry point instead of the deprecated squad-engine.
 */
import { processDelegate } from './submit-plan.js';
import { startServer } from './server-lifecycle.js';

export default function squadPlugin(pi) {
    globalThis.PI = pi;

    return {
        name: 'squad-tau',
        tools: [
            {
                name: 'squad_delegate',
                description: 'Delegate a plan to the Squad-Tau execution engine',
                parameters: {
                    type: 'object',
                    properties: {
                        plan_dir: {
                            type: 'string',
                            description: 'Directory containing .toml node definition files',
                        },
                    },
                    required: ['plan_dir'],
                },
                handler: async (params, runState) => {
                    return await processDelegate(params, runState);
                },
            },
        ],
        onStart: async () => {
            startServer();
        },
    };
}
