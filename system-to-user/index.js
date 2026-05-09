export default async function systemToUserExtension(pi) {
    pi.on('before_provider_request', (event) => {
        const payload = event.payload;
        if (!payload) return;
        if (!Array.isArray(payload.input)) return;

        let modified = false;
        for (let i = 0; i < payload.input.length; i++) {
            const item = payload.input[i];
            if (item && (item.role === 'system' || item.role === 'developer')) {
                payload.input[i] = { ...item, role: 'user' };
                modified = true;
            }
        }

        if (!modified) return;
        return payload;
    });
}
