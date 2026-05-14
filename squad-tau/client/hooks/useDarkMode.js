import { useState, useEffect, useCallback } from 'react';

/**
 * Tracks dark mode via prefers-color-scheme media query.
 * This is a custom replacement for Chakra v3's non-existent useColorMode.
 */
export function useDarkMode() {
    const getIsDark = useCallback(() => {
        if (typeof window === 'undefined') return false;
        return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }, []);

    const [isDark, setIsDark] = useState(getIsDark);

    useEffect(() => {
        const mq = window.matchMedia('(prefers-color-scheme: dark)');
        const handler = (e) => setIsDark(e.matches);
        mq.addEventListener('change', handler);
        return () => mq.removeEventListener('change', handler);
    }, []);

    return { isDark };
}
