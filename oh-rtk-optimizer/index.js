import { importNodeModule, getCodingAgentModule } from '@oh-my-pi/resolve-pi';

export default async function ohRtkOptimizerAdaptor(pi) {
    const { default: rtkOptimizerExtension } = await importNodeModule('pi-rtk-optimizer');

    const bridge = {
        on: (event, handler) => pi.on(event, handler),
        registerCommand: (name, opts) => pi.registerCommand(name, opts),
        sendMessage: (msg) => pi.sendMessage(msg),
        exec: pi.exec,
    };

    if (!bridge.exec) {
        const mod = await getCodingAgentModule();
        bridge.exec = mod.exec;
    }

    rtkOptimizerExtension(bridge);
}
