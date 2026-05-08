export default async function systemToUserExtension(pi) {
    pi.on('before_provider_request', (event) => {
        const payload = event.payload;
        if (!payload) return;
        if (!Array.isArray(payload.messages)) return;

        let modified = false;
        for (let i = 0; i < payload.messages.length; i++) {
            const msg = payload.messages[i];
            if (msg && msg.role === 'system') {
                payload.messages[i] = { ...msg, role: 'user' };
                modified = true;
            }
        }

        if (!modified) return;
        return payload;
    });
}
